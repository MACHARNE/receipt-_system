// ============================================================
// utils/receiptNumber.js — Atomic receipt number generation
// ============================================================
// Format: ABBR-TYPE-YYYY-NNNNN
// Example: IDK-SCHOOLFE-2026-00001
//
// Rules:
//   - ABBR comes from companies.abbreviation
//   - YYYY is the current year
//   - NNNNN is a per company + per year + per receipt type counter
//   - Never reuses a number, even for voided receipts
// ============================================================

const pool = require("../db");

/**
 * Generate a receipt number inside an existing transaction.
 * The caller MUST pass a `client` from pool.connect() and be inside BEGIN/COMMIT.
 */
async function generateReceiptNumber(client, companyId, receiptTypeId) {
    // 1. Fetch the company abbreviation and a short receipt-type code.
    const cRes = await client.query(
        "SELECT abbreviation FROM companies WHERE id = $1",
        [companyId]
    );
    if (cRes.rows.length === 0) throw new Error("Company not found");
    const abbr = (cRes.rows[0].abbreviation || "RCPT").toUpperCase();
    const typeRes = await client.query(
        "SELECT code FROM receipt_types WHERE id = $1",
        [receiptTypeId]
    );
    if (typeRes.rows.length === 0) throw new Error("Receipt type not found");
    const typeCode = typeRes.rows[0].code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "TYPE";

    // 2. Current year
    const year = new Date().getFullYear();

    // 3. Lock the counter row for this company+year+type and increment
    //    UPSERT + RETURNING is atomic under READ COMMITTED.
    const counterRes = await client.query(
        `INSERT INTO receipt_counters (company_id, year, receipt_type_id, last_number)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (company_id, year, receipt_type_id)
         DO UPDATE SET last_number = receipt_counters.last_number + 1
         RETURNING last_number`,
        [companyId, year, receiptTypeId]
    );

    const n = counterRes.rows[0].last_number;
    const padded = String(n).padStart(5, "0");

    return `${abbr}-${typeCode}-${year}-${padded}`;
}

module.exports = { generateReceiptNumber };
