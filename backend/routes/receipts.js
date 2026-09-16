// ============================================================
// routes/receipts.js — Receipt creation, retrieval, void
// ============================================================
// Endpoints:
//   GET    /receipts                      — list with filters + pagination
//   GET    /receipts/:id                  — full receipt (with items + field values)
//   GET    /receipts/:id/pdf              — downloadable PDF
//   POST   /receipts                      — create
//   POST   /receipts/:id/void             — void with reason
//   GET    /receipts/next-options         — types + templates + items for the form
//   GET    /receipts/type/:typeId/fields  — merged master + custom fields
// ============================================================

const express = require("express");
const pool = require("../db");
const { requireCompanyUser, requireRole } = require("../middleware/auth");
const { generateReceiptNumber } = require("../utils/receiptNumber");
const { loadReceiptBundle } = require("../utils/receiptData");
const { verifyUrlFor } = require("../utils/verifyUrl");
const { qrDataUrl } = require("../utils/qr");
const { buildReceiptPdf } = require("../utils/pdf");

const router = express.Router();
router.use(requireCompanyUser);

const SCHOOL_TERM_OPTIONS = ["First Term", "Second Term", "Third Term"];

// ============================================================
// HELPERS
// ============================================================

async function getCompanyLimits(companyId) {
    const r = await pool.query(
        "SELECT max_receipt_items, default_currency FROM companies WHERE id = $1",
        [companyId]
    );
    return r.rows[0] || { max_receipt_items: 10, default_currency: "NGN" };
}

// Validate a single line item array against company max_receipt_items
function validateItems(items, maxItems) {
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, message: "At least one item is required." };
    }
    if (items.length > maxItems) {
        return {
            ok: false,
            code: "PLAN_LIMIT_REACHED",
            message: `Your plan allows up to ${maxItems} items per receipt. You sent ${items.length}.`,
        };
    }
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.item_name || String(it.item_name).trim() === "") {
            return { ok: false, message: `Item ${i + 1}: name is required.` };
        }
        const qty = Number(it.quantity);
        const price = Number(it.unit_price);
        if (isNaN(qty) || qty <= 0) return { ok: false, message: `Item ${i + 1}: quantity must be > 0.` };
        if (isNaN(price) || price < 0) return { ok: false, message: `Item ${i + 1}: unit_price must be >= 0.` };
    }
    return { ok: true };
}

// Compute money fields server-side. Never trust the client.
function computeMoney(items, discount_type, discount_value) {
    let subtotal = 0;
    const lines = items.map(it => {
        const qty = Number(it.quantity);
        const price = Number(it.unit_price);
        const line_total = Math.round(qty * price * 100) / 100;
        subtotal += line_total;
        return { ...it, quantity: qty, unit_price: price, line_total };
    });
    subtotal = Math.round(subtotal * 100) / 100;

    let discount_amount = 0;
    if (discount_type === "fixed") {
        discount_amount = Math.max(0, Number(discount_value) || 0);
    } else if (discount_type === "percent") {
        const pct = Math.max(0, Math.min(100, Number(discount_value) || 0));
        discount_amount = Math.round(subtotal * pct) / 100;
    }
    discount_amount = Math.min(discount_amount, subtotal);

    const total = Math.round((subtotal - discount_amount) * 100) / 100;
    return { lines, subtotal, discount_amount, total };
}

function computeStatus(amount_paid, total) {
    if (amount_paid <= 0) return "unpaid";
    if (amount_paid >= total) return "paid";
    return "partial";
}

// ============================================================
// GET /receipts/next-options
//   Everything the New Receipt page needs in one call.
// ============================================================
router.get("/next-options", async (req, res) => {
    try {
        const companyId = req.session.companyId;

        const types = await pool.query(
            `SELECT rt.id, rt.code, rt.name, rt.icon
             FROM receipt_types rt
             JOIN company_receipt_types crt
               ON crt.receipt_type_id = rt.id
              AND crt.company_id = $1
              AND crt.is_enabled = TRUE
             ORDER BY rt.name ASC`,
            [companyId]
        );

        const templates = await pool.query(
            `SELECT t.id, t.name, t.receipt_type_id, t.default_footer, t.default_notes,
                    t.default_field_values,
                    rt.name AS type_name
             FROM receipt_templates t
             JOIN receipt_types rt ON rt.id = t.receipt_type_id
             WHERE t.company_id = $1 AND t.is_active = TRUE
             ORDER BY t.updated_at DESC`,
            [companyId]
        );

        const items = await pool.query(
            `SELECT id, name, description, default_price
             FROM items
             WHERE company_id = $1 AND status = 'active'
             ORDER BY name ASC`,
            [companyId]
        );

        const themes = await pool.query(
            `SELECT receipt_type_id, base_color, last_used_at
             FROM company_receipt_type_themes WHERE company_id = $1`,
            [companyId]
        );

        const limits = await getCompanyLimits(companyId);

        res.json({
            types: types.rows,
            templates: templates.rows,
            items: items.rows,
            themes: themes.rows,
            limits: {
                max_receipt_items: limits.max_receipt_items,
                default_currency: limits.default_currency,
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load options." });
    }
});

// ============================================================
// GET /receipts/type/:typeId/fields
//   Merged master + custom fields for the dynamic form.
// ============================================================
router.get("/type/:typeId/fields", async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const typeId = parseInt(req.params.typeId, 10);

        const master = await pool.query(
            `SELECT field_key, field_label, field_type, is_required,
                    options, placeholder, display_order
             FROM receipt_type_fields
             WHERE receipt_type_id = $1
             ORDER BY display_order ASC`,
            [typeId]
        );

        const custom = await pool.query(
            `SELECT field_key, field_label, field_type, is_required,
                    options, default_value, placeholder, display_order
             FROM company_receipt_type_fields
             WHERE company_id = $1 AND receipt_type_id = $2
             ORDER BY display_order ASC`,
            [companyId, typeId]
        );

        // Merge; custom after master. Same shape for both.
        const merged = [
            ...master.rows.map(f => ({ ...f, origin: "master" })),
            ...custom.rows.map(f => ({ ...f, origin: "custom" })),
        ].map(field => (
            field.field_key === "term" && field.field_type === "select" && !field.options?.length
                ? { ...field, options: SCHOOL_TERM_OPTIONS }
                : field
        ));

        // Also give the theme so the form can color itself
        const theme = await pool.query(
            `SELECT base_color FROM company_receipt_type_themes
             WHERE company_id = $1 AND receipt_type_id = $2`,
            [companyId, typeId]
        );

        res.json({
            fields: merged,
            theme_base_color: theme.rows[0]?.base_color || null,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load fields." });
    }
});

// ============================================================
// GET /receipts — list with filters
// ============================================================
router.get("/", async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const {
            q = "",
            receipt_type_id,
            status,
            payment_method,
            date_from,
            date_to,
            page = 1,
            pageSize = 25,
        } = req.query;

        const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
        const offset = ((parseInt(page, 10) || 1) - 1) * limit;

        const where = ["r.company_id = $1"];
        const params = [companyId];
        let p = 2;

        if (q.trim()) {
            where.push(`(r.receipt_number ILIKE $${p}
                       OR r.customer_name ILIKE $${p}
                       OR r.customer_phone ILIKE $${p})`);
            params.push(`%${q.trim()}%`);
            p++;
        }
        if (receipt_type_id) {
            where.push(`r.receipt_type_id = $${p}`);
            params.push(parseInt(receipt_type_id, 10));
            p++;
        }
        if (status && ["draft","issued","paid","partial","unpaid","void","cancelled","refunded"].includes(status)) {
            where.push(`r.status = $${p}`);
            params.push(status);
            p++;
        }
        if (payment_method) {
            where.push(`r.payment_method = $${p}`);
            params.push(payment_method);
            p++;
        }
        if (date_from) {
            where.push(`r.payment_date >= $${p}`);
            params.push(date_from);
            p++;
        }
        if (date_to) {
            where.push(`r.payment_date <= $${p}`);
            params.push(date_to);
            p++;
        }

        const whereSql = "WHERE " + where.join(" AND ");

        const countRes = await pool.query(
            `SELECT COUNT(*)::int AS total FROM receipts r ${whereSql}`,
            params
        );

        const listRes = await pool.query(
            `SELECT r.id, r.receipt_number, r.verification_token,
                    r.customer_name, r.customer_phone,
                    r.total, r.amount_paid, r.balance,
                    r.status, r.payment_method, r.payment_date,
                    r.created_at,
                    rt.name AS type_name, rt.code AS type_code,
                    u.full_name AS created_by_name
             FROM receipts r
             JOIN receipt_types rt ON rt.id = r.receipt_type_id
             LEFT JOIN users u ON u.id = r.created_by
             ${whereSql}
             ORDER BY r.created_at DESC
             LIMIT $${p} OFFSET $${p + 1}`,
            [...params, limit, offset]
        );

        const total = countRes.rows[0].total;

        res.json({
            receipts: listRes.rows,
            pagination: {
                total,
                page: parseInt(page, 10) || 1,
                pageSize: limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load receipts." });
    }
});

// ============================================================
// GET /receipts/:id — full receipt with items and field values
// ============================================================
router.get("/:id", async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ message: "Invalid receipt id." });
        }

        const bundle = await loadReceiptBundle(companyId, id);
        if (!bundle) {
            return res.status(404).json({ message: "Receipt not found." });
        }

        // The QR code points at the public verification page, so anyone holding
        // the receipt can confirm it without signing in.
        const verifyUrl = verifyUrlFor(req, bundle.receipt.verification_token);
        let qrCode = null;
        try {
            qrCode = await qrDataUrl(verifyUrl);
        } catch (qrError) {
            console.error("Failed to create receipt QR code:", qrError);
        }

        res.json({ ...bundle, qr_code: qrCode, verify_url: verifyUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load receipt." });
    }
});

// ============================================================
// GET /receipts/:id/pdf — downloadable PDF
// ============================================================
router.get("/:id/pdf", async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ message: "Invalid receipt id." });
        }

        const bundle = await loadReceiptBundle(companyId, id);
        if (!bundle) {
            return res.status(404).json({ message: "Receipt not found." });
        }

        const verifyUrl = verifyUrlFor(req, bundle.receipt.verification_token);
        const pdf = await buildReceiptPdf(bundle, { verifyUrl });

        // Receipt numbers are generated by us, but strip anything unexpected so
        // a crafted value can never break out of the header.
        const safeName = String(bundle.receipt.receipt_number || "receipt").replace(/[^A-Za-z0-9._-]/g, "");

        res.set({
            "Content-Type": "application/pdf",
            "Content-Length": pdf.length,
            "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        });
        res.send(pdf);
    } catch (err) {
        console.error("Receipt PDF failed:", err);
        res.status(500).json({ message: "Could not create a PDF for this receipt. Please try again." });
    }
});

// ============================================================
// POST /receipts — create
// ============================================================
router.post("/", requireRole("owner", "admin", "staff"), async (req, res) => {
    const client = await pool.connect();
    try {
        const companyId = req.session.companyId;
        const {
            receipt_type_id,
            template_id,
            field_values,            // object { field_key: value }
            customer_id,             // optional if customer_name given
            customer_name,
            customer_phone,
            customer_email,
            items,                   // array
            discount_type,           // null | 'fixed' | 'percent'
            discount_value,
            payment_method,
            amount_paid,
            payment_reference,
            payment_date,
            notes,
            theme_base_color,        // optional; save as type default
        } = req.body;

        // ---- Validation ----
        if (!receipt_type_id) return res.status(400).json({ message: "receipt_type_id is required." });

        const limits = await getCompanyLimits(companyId);
        const itemsCheck = validateItems(items, limits.max_receipt_items);
        if (!itemsCheck.ok) {
            return res.status(itemsCheck.code === "PLAN_LIMIT_REACHED" ? 403 : 400).json(itemsCheck);
        }

        // Verify type is enabled for this company
        const enabled = await client.query(
            `SELECT 1 FROM company_receipt_types
             WHERE company_id = $1 AND receipt_type_id = $2 AND is_enabled = TRUE`,
            [companyId, receipt_type_id]
        );
        if (enabled.rows.length === 0) {
            return res.status(400).json({ message: "This receipt type is not enabled for your company." });
        }

        // Compute money server-side
        const money = computeMoney(items, discount_type, discount_value);

        const paid = Number(amount_paid) || 0;
        if (paid < 0) return res.status(400).json({ message: "amount_paid cannot be negative." });
        if (paid > money.total + 0.01) {
            return res.status(400).json({ message: "amount_paid cannot exceed the total." });
        }
        const balance = Math.max(0, Math.round((money.total - paid) * 100) / 100);
        const status = computeStatus(paid, money.total);

        await client.query("BEGIN");

        // ---- Customer resolution ----
        let finalCustomerId = customer_id || null;
        let finalCustomerName = customer_name || null;
        let finalCustomerPhone = customer_phone || null;
        let finalCustomerEmail = customer_email || null;

        if (!finalCustomerId && finalCustomerName && finalCustomerName.trim()) {
            // Reuse by phone if given
            if (finalCustomerPhone) {
                const existing = await client.query(
                    `SELECT id, full_name, phone, email FROM customers
                     WHERE company_id = $1 AND phone = $2 LIMIT 1`,
                    [companyId, finalCustomerPhone]
                );
                if (existing.rows.length) {
                    finalCustomerId = existing.rows[0].id;
                }
            }
            if (!finalCustomerId) {
                const ins = await client.query(
                    `INSERT INTO customers
                        (company_id, customer_type, full_name, phone, email)
                     VALUES ($1, 'customer', $2, $3, $4)
                     RETURNING id`,
                    [companyId, finalCustomerName.trim(), finalCustomerPhone, finalCustomerEmail]
                );
                finalCustomerId = ins.rows[0].id;
            }
        }

        // ---- Receipt number ----
        const receiptNumber = await generateReceiptNumber(client, companyId, receipt_type_id);

        // ---- Insert receipt ----
        const receiptRes = await client.query(
            `INSERT INTO receipts
                (company_id, receipt_type_id, template_id, invoice_id,
                 receipt_number,
                 customer_id, customer_name, customer_phone, customer_email, customer_ref,
                 subtotal, discount_type, discount_value, discount_amount, total,
                 amount_paid, balance,
                 payment_method, payment_reference, payment_date, notes,
                 status, created_by)
             VALUES
                ($1, $2, $3, NULL,
                 $4,
                 $5, $6, $7, $8, NULL,
                 $9, $10, $11, $12, $13,
                 $14, $15,
                 $16, $17, COALESCE($18, CURRENT_DATE), $19,
                 $20, $21)
             RETURNING id, receipt_number, verification_token, status, total, balance, amount_paid`,
            [
                companyId, receipt_type_id, template_id || null,
                receiptNumber,
                finalCustomerId, finalCustomerName, finalCustomerPhone, finalCustomerEmail,
                money.subtotal,
                discount_type || null,
                discount_value != null ? Number(discount_value) : null,
                money.discount_amount,
                money.total,
                paid, balance,
                payment_method || null, payment_reference || null, payment_date || null, notes || null,
                status, req.session.userId,
            ]
        );
        const receiptId = receiptRes.rows[0].id;

        // ---- Insert items ----
        for (let i = 0; i < money.lines.length; i++) {
            const it = money.lines[i];
            await client.query(
                `INSERT INTO receipt_items
                    (receipt_id, item_id, item_name, description, quantity, unit_price, line_total, display_order)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    receiptId, it.item_id || null,
                    String(it.item_name).trim(),
                    it.description || null,
                    it.quantity, it.unit_price, it.line_total,
                    i,
                ]
            );
        }

        // ---- Insert field values ----
        if (field_values && typeof field_values === "object") {
            for (const [key, value] of Object.entries(field_values)) {
                if (value === null || value === undefined || value === "") continue;
                await client.query(
                    `INSERT INTO receipt_field_values (receipt_id, field_key, field_value)
                     VALUES ($1, $2, $3)`,
                    [receiptId, key, String(value)]
                );
            }
        }

        // ---- Save theme base color as the type default (retain for next time) ----
        if (theme_base_color && /^#?[0-9a-fA-F]{6}$/.test(theme_base_color)) {
            const { buildTheme } = require("../utils/theme");
            const resolved = buildTheme(theme_base_color);
            await client.query(
                `INSERT INTO company_receipt_type_themes
                    (company_id, receipt_type_id, base_color, header_text_color, accent_color, updated_at, last_used_at)
                 VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                 ON CONFLICT (company_id, receipt_type_id) DO UPDATE
                    SET base_color = $3, header_text_color = $4,
                        accent_color = $5, updated_at = NOW(), last_used_at = NOW()`,
                [companyId, receipt_type_id, resolved.base_color, resolved.header_text_color, resolved.accent_bg]
            );
        }

        // ---- Audit log ----
        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'receipt.created', 'receipt', $3, $4, $5)`,
            [
                companyId, req.session.userId, receiptId,
                JSON.stringify({
                    receipt_number: receiptNumber,
                    total: money.total,
                    status,
                }),
                req.ip,
            ]
        );

        await client.query("COMMIT");

        res.status(201).json({
            message: "Receipt created.",
            receipt: receiptRes.rows[0],
        });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Create receipt error:", err);
        res.status(500).json({ message: "Failed to create receipt." });
    } finally {
        client.release();
    }
});

// ============================================================
// POST /receipts/:id/void
// ============================================================
router.post("/:id/void", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);
        const { reason } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({ message: "A reason is required to void a receipt." });
        }

        const existing = await pool.query(
            "SELECT status FROM receipts WHERE id = $1 AND company_id = $2",
            [id, companyId]
        );
        if (existing.rows.length === 0) return res.status(404).json({ message: "Receipt not found." });
        if (existing.rows[0].status === "void") {
            return res.status(409).json({ message: "Receipt is already void." });
        }

        const result = await pool.query(
            `UPDATE receipts
             SET status = 'void', void_reason = $1, voided_by = $2, voided_at = NOW(), updated_at = NOW()
             WHERE id = $3 AND company_id = $4
             RETURNING id, receipt_number, status`,
            [reason.trim(), req.session.userId, id, companyId]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, reason, ip_address)
             VALUES ($1, $2, 'receipt.voided', 'receipt', $3, $4, $5, $6)`,
            [companyId, req.session.userId, id,
             JSON.stringify({ status: "void" }), reason.trim(), req.ip]
        );

        res.json({ message: "Receipt voided.", receipt: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to void receipt." });
    }
});

module.exports = router;
