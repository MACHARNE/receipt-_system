// ============================================================
// utils/receiptData.js — Load everything needed to render a receipt
// ============================================================
// Used by both the JSON endpoint (screen) and the PDF endpoint, so the two
// renderers can never drift apart or disagree about a company or an amount.
//
// Every query is scoped by company_id: a receipt belonging to another tenant
// looks exactly like a missing receipt.
// ============================================================

const pool = require("../db");

/**
 * @param {number} companyId  tenant, taken from the session (never the client)
 * @param {number} receiptId
 * @param {{query: Function}} [db]
 * @returns {Promise<null|{receipt: object, items: object[], field_values: object,
 *                          company: object, theme_base_color: string|null}>}
 */
async function loadReceiptBundle(companyId, receiptId, db = pool) {
    const receiptRes = await db.query(
        `SELECT r.*,
                rt.name AS type_name, rt.code AS type_code,
                u.full_name AS created_by_name,
                v.full_name AS voided_by_name
         FROM receipts r
         JOIN receipt_types rt ON rt.id = r.receipt_type_id
         LEFT JOIN users u ON u.id = r.created_by
         LEFT JOIN users v ON v.id = r.voided_by
         WHERE r.id = $1 AND r.company_id = $2`,
        [receiptId, companyId]
    );
    if (receiptRes.rows.length === 0) return null;

    const receipt = receiptRes.rows[0];

    const [items, fieldValues, companyRes, themeRes] = await Promise.all([
        db.query(
            `SELECT id, item_id, item_name, description, quantity, unit_price, line_total, display_order
             FROM receipt_items WHERE receipt_id = $1 ORDER BY display_order ASC`,
            [receiptId]
        ),
        db.query(
            `SELECT field_key, field_value FROM receipt_field_values WHERE receipt_id = $1`,
            [receiptId]
        ),
        db.query(
            `SELECT name, abbreviation, logo_path, use_logo_watermark, address,
                    phone, email, website, tin, cac_number, default_currency,
                    receipt_footer, header_position
             FROM companies WHERE id = $1`,
            [companyId]
        ),
        db.query(
            `SELECT base_color FROM company_receipt_type_themes
             WHERE company_id = $1 AND receipt_type_id = $2`,
            [companyId, receipt.receipt_type_id]
        ),
    ]);

    const fieldValuesMap = {};
    fieldValues.rows.forEach(fv => { fieldValuesMap[fv.field_key] = fv.field_value; });

    return {
        receipt,
        items: items.rows,
        field_values: fieldValuesMap,
        company: companyRes.rows[0] || {},
        theme_base_color: themeRes.rows[0]?.base_color || null,
    };
}

module.exports = { loadReceiptBundle };
