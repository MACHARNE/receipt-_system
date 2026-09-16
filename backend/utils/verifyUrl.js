// ============================================================
// utils/verifyUrl.js — The public link a scanned QR code opens
// ============================================================
// A QR code must contain an absolute URL, because the phone that scans it is
// not on this server. In production set PUBLIC_BASE_URL to the real domain
// (https://receipts.example.com); otherwise we fall back to the host the
// request arrived on, which is correct for local development.
// ============================================================

function publicBaseUrl(req) {
    const configured = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    if (configured) return configured;
    return `${req.protocol}://${req.get("host")}`;
}

function verifyUrlFor(req, verificationToken) {
    return `${publicBaseUrl(req)}/verify/${verificationToken}`;
}

module.exports = { publicBaseUrl, verifyUrlFor };
