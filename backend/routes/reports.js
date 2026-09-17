// ============================================================
// routes/reports.js — Collection and activity reports
// ============================================================
//   GET /reports/summary       — totals + breakdowns for a date range
//   GET /reports/receipts.csv  — the same period's receipts as a spreadsheet
//
// Two decisions worth knowing:
//
//   1. Voided receipts are excluded from every money total. A receipt that was
//      cancelled did not collect anything, and counting it would overstate the
//      day's takings. Voided receipts are reported separately so they remain
//      visible rather than silently disappearing.
//
//   2. The date used is the date the money moved (payment_date), falling back to
//      when the receipt was created. A receipt issued on the 30th for a payment
//      made on the 28th belongs to the 28th.
//
// Invoices are not reported on: the invoice module does not exist yet (§25), so
// there is nothing to summarise.
// ============================================================

const express = require("express");
const pool = require("../db");
const { requireCompanyUser, requireRole } = require("../middleware/auth");

const router = express.Router();

// §7.4: staff and cashiers cannot view reports.
router.use(requireCompanyUser, requireRole("owner", "admin"));

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Resolve the requested period, defaulting to the current month.
 * Refuses to guess at malformed input rather than silently reporting the wrong
 * period, which would be worse than an error.
 */
function resolveRange(query) {
    const from = String(query.from || "").trim();
    const to = String(query.to || "").trim();

    if (from && !DATE_PATTERN.test(from)) return { error: "The 'from' date must be in YYYY-MM-DD format." };
    if (to && !DATE_PATTERN.test(to)) return { error: "The 'to' date must be in YYYY-MM-DD format." };

    const resolvedFrom = from || firstOfMonthIso();
    const resolvedTo = to || todayIso();

    if (resolvedFrom > resolvedTo) {
        return { error: "The start date must be on or before the end date." };
    }

    return { from: resolvedFrom, to: resolvedTo };
}

// The expression used everywhere as "the day this receipt belongs to".
const DAY = "COALESCE(r.payment_date, r.created_at::date)";

async function loadSummary(companyId, from, to) {
    const params = [companyId, from, to];
    const scope = `r.company_id = $1 AND ${DAY} BETWEEN $2::date AND $3::date`;

    const totalsRes = await pool.query(
        `SELECT
            COUNT(*)::int                                                            AS receipts,
            COUNT(*) FILTER (WHERE r.status = 'void')::int                            AS voided,
            COALESCE(SUM(r.total)           FILTER (WHERE r.status <> 'void'), 0)     AS billed,
            COALESCE(SUM(r.amount_paid)     FILTER (WHERE r.status <> 'void'), 0)     AS collected,
            COALESCE(SUM(r.balance)         FILTER (WHERE r.status <> 'void'), 0)     AS outstanding,
            COALESCE(SUM(r.discount_amount) FILTER (WHERE r.status <> 'void'), 0)     AS discounts
         FROM receipts r
         WHERE ${scope}`,
        params
    );

    const byTypeRes = await pool.query(
        `SELECT rt.name,
                COUNT(*)::int                                                        AS receipts,
                COALESCE(SUM(r.amount_paid) FILTER (WHERE r.status <> 'void'), 0)     AS collected,
                COALESCE(SUM(r.balance)     FILTER (WHERE r.status <> 'void'), 0)     AS outstanding
         FROM receipts r
         JOIN receipt_types rt ON rt.id = r.receipt_type_id
         WHERE ${scope}
         GROUP BY rt.name
         ORDER BY collected DESC, rt.name ASC`,
        params
    );

    const byMethodRes = await pool.query(
        `SELECT COALESCE(NULLIF(r.payment_method, ''), 'unspecified') AS method,
                COUNT(*)::int                                                    AS receipts,
                COALESCE(SUM(r.amount_paid) FILTER (WHERE r.status <> 'void'), 0) AS collected
         FROM receipts r
         WHERE ${scope}
         GROUP BY 1
         ORDER BY collected DESC`,
        params
    );

    const byStatusRes = await pool.query(
        `SELECT r.status, COUNT(*)::int AS receipts
         FROM receipts r
         WHERE ${scope}
         GROUP BY r.status
         ORDER BY receipts DESC`,
        params
    );

    const byStaffRes = await pool.query(
        `SELECT COALESCE(u.full_name, 'Unknown') AS staff,
                COUNT(*)::int                                                    AS receipts,
                COALESCE(SUM(r.amount_paid) FILTER (WHERE r.status <> 'void'), 0) AS collected
         FROM receipts r
         LEFT JOIN users u ON u.id = r.created_by
         WHERE ${scope}
         GROUP BY 1
         ORDER BY collected DESC`,
        params
    );

    const dailyRes = await pool.query(
        `SELECT ${DAY} AS day,
                COUNT(*)::int                                                    AS receipts,
                COALESCE(SUM(r.amount_paid) FILTER (WHERE r.status <> 'void'), 0) AS collected
         FROM receipts r
         WHERE ${scope}
         GROUP BY 1
         ORDER BY 1 ASC`,
        params
    );

    return {
        range: { from, to },
        totals: totalsRes.rows[0],
        by_type: byTypeRes.rows,
        by_method: byMethodRes.rows,
        by_status: byStatusRes.rows,
        by_staff: byStaffRes.rows,
        daily: dailyRes.rows,
    };
}

// ============================================================
// GET /reports/summary
// ============================================================
router.get("/summary", async (req, res) => {
    try {
        const range = resolveRange(req.query);
        if (range.error) return res.status(400).json({ message: range.error });

        const companyId = req.session.companyId;

        const company = await pool.query(
            "SELECT default_currency FROM companies WHERE id = $1", [companyId]);

        const summary = await loadSummary(companyId, range.from, range.to);

        res.json({
            ...summary,
            currency: company.rows[0]?.default_currency || null,
        });
    } catch (err) {
        console.error("Report summary failed:", err);
        res.status(500).json({ message: "Could not build that report. Please try again." });
    }
});

// ============================================================
// GET /reports/receipts.csv — the period as a spreadsheet
// ============================================================
// CSV rather than a PDF: the numbers are meant to be worked on, and every
// spreadsheet application opens it. A value that begins with =, +, - or @ is
// prefixed with an apostrophe so a customer name can never be executed as a
// formula when the file is opened.
const CSV_DAY = "COALESCE(r.payment_date, r.created_at::date)";

function csvCell(value) {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

router.get("/receipts.csv", async (req, res) => {
    try {
        const range = resolveRange(req.query);
        if (range.error) return res.status(400).json({ message: range.error });

        const companyId = req.session.companyId;

        const { rows } = await pool.query(
            `SELECT ${CSV_DAY} AS day, r.receipt_number, rt.name AS type_name,
                    r.customer_name, r.customer_ref, r.status,
                    r.subtotal, r.discount_amount, r.total, r.amount_paid, r.balance,
                    r.payment_method, r.payment_reference,
                    COALESCE(u.full_name, '') AS created_by
             FROM receipts r
             JOIN receipt_types rt ON rt.id = r.receipt_type_id
             LEFT JOIN users u ON u.id = r.created_by
             WHERE r.company_id = $1 AND ${CSV_DAY} BETWEEN $2::date AND $3::date
             ORDER BY ${CSV_DAY} ASC, r.id ASC`,
            [companyId, range.from, range.to]
        );

        const header = [
            "Date", "Receipt number", "Type", "Customer", "Reference", "Status",
            "Subtotal", "Discount", "Total", "Paid", "Balance",
            "Payment method", "Payment reference", "Issued by",
        ];

        const lines = [header.join(",")];
        for (const row of rows) {
            lines.push([
                row.day instanceof Date ? row.day.toISOString().slice(0, 10) : row.day,
                row.receipt_number, row.type_name, row.customer_name, row.customer_ref, row.status,
                row.subtotal, row.discount_amount, row.total, row.amount_paid, row.balance,
                row.payment_method, row.payment_reference, row.created_by,
            ].map(csvCell).join(","));
        }

        const filename = `receipts-${range.from}-to-${range.to}.csv`;
        res.set({
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        });
        // The BOM makes Excel read UTF-8 correctly instead of mangling accents.
        res.send("\uFEFF" + lines.join("\r\n") + "\r\n");
    } catch (err) {
        console.error("Report CSV failed:", err);
        res.status(500).json({ message: "Could not export that report. Please try again." });
    }
});

module.exports = router;
