// ============================================================
// routes/verify.js — Public receipt verification
// ============================================================
// Deliberately unauthenticated: this is what a QR code on a printed receipt
// opens, and the person scanning it is a customer, auditor or stranger.
//
// Two routes, because the URL a QR code points at must be a page a human can
// read, while that page still needs data:
//
//   GET /verify/:token        → verify.html (the page)
//   GET /verify/:token/data   → JSON the page renders
//
// What the data exposes is limited on purpose:
//   company name, receipt number, date, amount paid, status
// It never returns customer contact details, line items, internal IDs, notes,
// or the verification token itself — knowing a receipt exists must not become
// a way to harvest the company's customers.
// ============================================================

const express = require("express");
const path = require("node:path");
const pool = require("../db");
const { rateLimit } = require("../middleware/rateLimit");

const router = express.Router();

const VERIFY_PAGE = path.join(__dirname, "..", "..", "frontend", "verify.html");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Public and unauthenticated, so it is worth protecting from being used as a
// free database-query endpoint. A genuine scan happens a handful of times, so
// the limit is far above real use; the page route is left unguarded because it
// serves a static file and touches no data.
const verifyGuard = rateLimit({
    name: "verify",
    windowMs: 10 * 60 * 1000,
    max: 100,
    message: "Too many verification requests. Please wait a few minutes and try again.",
});

// ============================================================
// GET /verify/:token — the page a QR code opens
// ============================================================
// Always serves the page, even for a malformed code: the page then reports
// "not verified", which is friendlier than a bare 404 and keeps the QR target
// stable. js/verify.js reads the token from the URL.
router.get("/:token", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(VERIFY_PAGE, err => { if (err) next(err); });
});

// ============================================================
// GET /verify/:token/data — the verification result
// ============================================================
router.get("/:token/data", verifyGuard, async (req, res) => {
    const token = String(req.params.token || "").trim().toLowerCase();

    // Reject non-UUID shapes before touching the database.
    if (!UUID_PATTERN.test(token)) {
        return res.status(404).json({
            found: false,
            message: "No receipt matches this code.",
        });
    }

    try {
        const { rows } = await pool.query(
            `SELECT r.receipt_number, r.status, r.amount_paid,
                    r.payment_date, r.created_at,
                    c.name AS company_name
             FROM receipts r
             JOIN companies c ON c.id = r.company_id
             WHERE r.verification_token = $1`,
            [token]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                found: false,
                message: "No receipt matches this code.",
            });
        }

        const receipt = rows[0];
        const status = String(receipt.status || "").toUpperCase();
        const isVoid = receipt.status === "void";

        // Verification results must never be cached by a proxy or browser.
        res.set("Cache-Control", "no-store");
        res.json({
            found: true,
            verified: !isVoid,
            company: receipt.company_name,
            receipt_number: receipt.receipt_number,
            date: receipt.payment_date || receipt.created_at,
            amount_paid: receipt.amount_paid,
            status,
            ...(isVoid
                ? { message: "This receipt has been voided and is no longer valid." }
                : {}),
        });
    } catch (err) {
        console.error("Receipt verification failed:", err);
        res.status(500).json({
            found: false,
            message: "We could not check this receipt right now. Please try again.",
        });
    }
});

module.exports = router;
