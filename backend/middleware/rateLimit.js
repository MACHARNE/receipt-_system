// ============================================================
// middleware/rateLimit.js — Fixed-window rate limiting
// ============================================================
// Dependency-free protection for the endpoints an attacker can reach without
// an account: signing in, and public receipt verification.
//
// Scope and honest limitations:
//   - State lives in this process's memory. Restarting the server clears it, and
//     it does NOT protect a multi-instance deployment — move to a shared store
//     (Redis) if this app is ever scaled horizontally.
//   - The window is fixed, not sliding, so a burst that straddles a window
//     boundary can briefly reach twice the limit. For brute-force protection
//     that is harmless: the goal is to make guessing impractical, not exact.
//   - Keying uses req.ip. Behind a reverse proxy that is the proxy's address
//     unless Express is told to trust X-Forwarded-For — see TRUST_PROXY in
//     server.js and §47 of the PRD, otherwise one shared bucket covers everyone.
//   - Offices and schools share one public IP, so limits are deliberately
//     generous where a whole network is involved, and account-scoped where the
//     real risk is guessing one person's password.
// ============================================================

const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;

/** key → { start, count, windowMs } */
const buckets = new Map();

// Drop expired buckets so a flood of distinct keys cannot grow memory forever.
const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (now - bucket.start >= bucket.windowMs) buckets.delete(key);
    }
}, SWEEP_INTERVAL_MS);
if (typeof sweeper.unref === "function") sweeper.unref();

function clientIp(req) {
    return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * @param {object} options
 * @param {string} options.name        namespace, so limiters stay independent
 * @param {number} options.windowMs    window length in milliseconds
 * @param {number} options.max         allowed requests (or failures) per window
 * @param {(req) => string} [options.by]  extra key part, e.g. the email being tried
 * @param {string} options.message     plain-language text shown to the user
 * @param {number[]} [options.countStatuses]
 *        When set, only responses with one of these status codes count towards
 *        the limit. Used for sign-in, where counting successes would punish a
 *        legitimate user who logs in and out repeatedly — only failures should
 *        accumulate. When omitted, every request counts.
 */
function rateLimit({ name, windowMs, max, by, message, countStatuses }) {
    const countEverything = !Array.isArray(countStatuses);

    const keyFor = req => {
        const extra = typeof by === "function" ? by(req) : "";
        return extra
            ? `${name}:${clientIp(req)}|${extra}`
            : `${name}:${clientIp(req)}`;
    };

    const bucketFor = (key, now) => {
        let bucket = buckets.get(key);
        if (bucket && now - bucket.start < windowMs) return bucket;

        if (buckets.size >= MAX_TRACKED_KEYS) {
            // Evict the single oldest bucket. Never clear the whole map: that
            // would let an attacker reset their own limit by flooding new keys.
            let oldestKey = null;
            let oldestStart = Infinity;
            for (const [candidate, entry] of buckets) {
                if (entry.start < oldestStart) {
                    oldestStart = entry.start;
                    oldestKey = candidate;
                }
            }
            if (oldestKey) buckets.delete(oldestKey);
        }

        bucket = { start: now, count: 0, windowMs };
        buckets.set(key, bucket);
        return bucket;
    };

    return function rateLimiter(req, res, next) {
        const key = keyFor(req);
        const now = Date.now();
        const bucket = bucketFor(key, now);

        if (bucket.count >= max) {
            const retryAfter = Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000));
            res.set("Retry-After", String(retryAfter));
            return res.status(429).json({
                message,
                code: "RATE_LIMITED",
                retryAfter,
            });
        }

        if (countEverything) {
            bucket.count += 1;
        } else {
            // Record the outcome once the response is known.
            res.on("finish", () => {
                if (countStatuses.includes(res.statusCode)) {
                    bucketFor(keyFor(req), Date.now()).count += 1;
                }
            });
        }

        return next();
    };
}

module.exports = { rateLimit };
