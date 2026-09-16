// ============================================================
// routes/receiptConfig.js — Receipt types, custom fields, themes, templates
// ============================================================
// Endpoints:
//   GET    /receipt-config/types
//   PUT    /receipt-config/types/:id/enable
//   PUT    /receipt-config/types/:id/disable
//   GET    /receipt-config/types/:id/fields               — master + custom merged
//   POST   /receipt-config/types/:id/fields               — add custom field
//   PUT    /receipt-config/types/:id/fields/:fieldId      — update custom field
//   DELETE /receipt-config/types/:id/fields/:fieldId      — delete custom field
//   GET    /receipt-config/types/:id/theme                — get resolved theme
//   PUT    /receipt-config/types/:id/theme                — set theme
//   GET    /receipt-config/templates
//   GET    /receipt-config/templates/:id
//   POST   /receipt-config/templates
//   PUT    /receipt-config/templates/:id
//   DELETE /receipt-config/templates/:id
// ============================================================

const express = require("express");
const pool = require("../db");
const { requireCompanyUser, requireRole } = require("../middleware/auth");
const { buildTheme } = require("../utils/theme");

const router = express.Router();
router.use(requireCompanyUser);
// Validate complete template submissions before starting a write transaction.
async function validateTemplate(req, res, next) {
    const body = req.body || {};
    req.body = body;
    body.custom_fields ??= [];
    body.default_items ??= [];
    const fail = message => res.status(400).json({ message });
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 150) return fail('Enter a template name up to 150 characters.');
    for (const key of ['description', 'default_footer', 'default_notes']) {
        if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > 10000)) return fail('Invalid ' + key + '.');
    }
    if (!Array.isArray(body.custom_fields) || !Array.isArray(body.default_items)) return fail('Custom fields and default items must be lists.');
    const defaults = body.default_field_values ?? {};
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return fail('Default field values must be a map.');
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return fail('Invalid active status.');
    try {
        let typeId = body.receipt_type_id;
        if (req.params.id) {
            const result = await pool.query('SELECT receipt_type_id FROM receipt_templates WHERE id = $1 AND company_id = $2', [req.params.id, req.user.company_id]);
            if (!result.rows[0]) return res.status(404).json({ message: 'Template not found.' });
            typeId = result.rows[0].receipt_type_id;
        }
        if (!Number.isSafeInteger(Number(typeId)) || Number(typeId) <= 0) return fail('Select a receipt type.');
        const master = await pool.query('SELECT field_key FROM receipt_type_fields WHERE receipt_type_id = $1', [typeId]);
        const custom = await pool.query('SELECT field_key FROM company_receipt_type_fields WHERE receipt_type_id = $1 AND company_id = $2', [typeId, req.user.company_id]);
        const keys = new Set([...master.rows, ...custom.rows].map(field => field.field_key));
        for (const [key, value] of Object.entries(defaults)) {
            if (!keys.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) return fail('Invalid default for master field ' + key + '.');
        }
        const types = ['text','number','date','select','currency','checkbox','phone','email','textarea'];
        for (const field of body.custom_fields) {
            if (!field || typeof field.field_key !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(field.field_key) || keys.has(field.field_key)) return fail('Custom field keys must be unique, start with a letter, and use lowercase letters, numbers or underscores.');
            keys.add(field.field_key);
            if (typeof field.field_label !== 'string' || !field.field_label.trim() || field.field_label.length > 120 || !types.includes(field.field_type)) return fail('Each custom field needs a label and valid type.');
            if (typeof field.is_required !== 'boolean') return fail('Invalid required flag.');
            if (field.options != null && (!Array.isArray(field.options) || field.options.some(option => typeof option !== 'string'))) return fail('Field options must be a list of text values.');
            if (field.field_type === 'select' && !field.options?.length) return fail('Select fields need at least one option.');
            if (field.default_value != null && typeof field.default_value !== 'string') return fail('Custom default values must be text.');
        }
        for (const item of body.default_items) {
            if (!item || typeof item.item_name !== 'string' || !item.item_name.trim() || item.item_name.length > 150 || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || item.unit_price == null || item.unit_price === '' || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0) return fail('Each default item needs a name, positive quantity and non-negative price.');
            if (item.item_id != null) {
                if (!Number.isSafeInteger(Number(item.item_id))) return fail('Invalid catalog item.');
                const owned = await pool.query('SELECT id FROM items WHERE id = $1 AND company_id = $2', [item.item_id, req.user.company_id]);
                if (!owned.rows.length) return fail('Catalog item does not belong to your company.');
            }
        }
        next();
    } catch (err) { next(err); }
}
router.param('id', (req, res, next, value) => {
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) return res.status(400).json({ message: 'Invalid ID.' });
    next();
});




// ============================================================
// HELPERS
// ============================================================

const VALID_FIELD_TYPES = [
    "text", "number", "date", "select", "currency",
    "checkbox", "phone", "email", "textarea",
];


router.param('fieldId', (req, res, next, value) => {
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) return res.status(400).json({ message: 'Invalid field ID.' });
    next();
});
router.use('/types/:id', async (req, res, next) => {
    try {
        const type = await pool.query('SELECT id FROM receipt_types WHERE id = $1', [req.params.id]);
        if (!type.rows.length) return res.status(404).json({ message: 'Receipt type not found.' });
        next();
    } catch (err) { next(err); }
});
function validateTypeField(req, res, next) {
    if (!['POST','PUT'].includes(req.method)) return next();
    const b = req.body || {};
    const fail = message => res.status(400).json({ message });
    if (typeof b.field_label !== 'string' || !b.field_label.trim() || b.field_label.length > 120) return fail('A field label of up to 120 characters is required.');
    if (b.field_key != null && typeof b.field_key !== 'string') return fail('Invalid field key.');
    const key = (b.field_key || b.field_label).toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,80);
    if (!key) return fail('Provide a field key containing letters or numbers.');
    if (!VALID_FIELD_TYPES.includes(b.field_type)) return fail('Invalid field type.');
    if (b.is_required !== undefined && typeof b.is_required !== 'boolean') return fail('Required must be true or false.');
    if (b.options != null && (!Array.isArray(b.options) || b.options.some(v => typeof v !== 'string' || !v.trim()))) return fail('Options must be a list of nonempty text values.');
    if (b.field_type === 'select' && !b.options?.length) return fail('Select fields need options.');
    if (b.default_value != null && typeof b.default_value !== 'string') return fail('Default value must be text.');
    if (b.placeholder != null && (typeof b.placeholder !== 'string' || b.placeholder.length > 150)) return fail('Placeholder must be at most 150 characters.');
    if (b.display_order !== undefined && (!Number.isInteger(b.display_order) || b.display_order < 0 || b.display_order > 2147483647)) return fail('Invalid display order.');
    next();
}
router.use('/types/:id/fields', validateTypeField);

async function getCompanyTheme(companyId) {
    const r = await pool.query(
        "SELECT receipt_theme FROM companies WHERE id = $1",
        [companyId]
    );
    return r.rows[0]?.receipt_theme || {};
}

async function getTypeTheme(companyId, typeId) {
    const r = await pool.query(
        `SELECT base_color, header_text_color, accent_color, updated_at, last_used_at
         FROM company_receipt_type_themes
         WHERE company_id = $1 AND receipt_type_id = $2`,
        [companyId, typeId]
    );
    return r.rows[0] || null;
}

// ============================================================
// RECEIPT TYPES
// ============================================================

// ------------------------------------------------------------
// GET /receipt-config/types
//   master types + enabled flag + master + custom field count + theme summary
// ------------------------------------------------------------
router.get("/types", async (req, res) => {
    try {
        const companyId = req.user.company_id;

        const types = await pool.query(
            `SELECT id, code, name, description, icon
             FROM receipt_types
             WHERE is_active = TRUE
             ORDER BY name ASC`
        );

        const enabled = await pool.query(
            `SELECT receipt_type_id, is_enabled
             FROM company_receipt_types WHERE company_id = $1`,
            [companyId]
        );
        const enabledMap = new Map(enabled.rows.map(r => [r.receipt_type_id, r.is_enabled]));

        const masterFields = await pool.query(
            `SELECT receipt_type_id, COUNT(*)::int AS n
             FROM receipt_type_fields GROUP BY receipt_type_id`
        );
        const masterCount = new Map(masterFields.rows.map(r => [r.receipt_type_id, r.n]));

        const customFields = await pool.query(
            `SELECT receipt_type_id, COUNT(*)::int AS n
             FROM company_receipt_type_fields
             WHERE company_id = $1
             GROUP BY receipt_type_id`,
            [companyId]
        );
        const customCount = new Map(customFields.rows.map(r => [r.receipt_type_id, r.n]));

        const themes = await pool.query(
            `SELECT receipt_type_id, base_color, updated_at, last_used_at
             FROM company_receipt_type_themes WHERE company_id = $1`,
            [companyId]
        );
        const themeMap = new Map(themes.rows.map(r => [r.receipt_type_id, r]));

        const templates = await pool.query(
            `SELECT receipt_type_id, COUNT(*)::int AS n
             FROM receipt_templates WHERE company_id = $1 AND is_active = TRUE
             GROUP BY receipt_type_id`,
            [companyId]
        );
        const templateCount = new Map(templates.rows.map(r => [r.receipt_type_id, r.n]));

        const allMaster = await pool.query('SELECT * FROM receipt_type_fields ORDER BY display_order');
        const result = types.rows.map(t => ({
            id: t.id,
            code: t.code,
            name: t.name,
            description: t.description,
            icon: t.icon,
            is_enabled: enabledMap.get(t.id) || false,
            master_field_count: masterCount.get(t.id) || 0,
            master_fields: allMaster.rows.filter(field => field.receipt_type_id === t.id),
            custom_field_count: customCount.get(t.id) || 0,
            template_count: templateCount.get(t.id) || 0,
            theme_base_color: themeMap.get(t.id)?.base_color || null,
        }));

        res.json({ types: result });
    } catch (err) {
        console.error("Read receipt types error:", err);
        res.status(500).json({ message: "Failed to load receipt types." });
    }
});

// ------------------------------------------------------------
// Enable / disable
// ------------------------------------------------------------
router.put("/types/:id/enable", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);

        await pool.query(
            `INSERT INTO company_receipt_types (company_id, receipt_type_id, is_enabled)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (company_id, receipt_type_id) DO UPDATE SET is_enabled = TRUE`,
            [companyId, typeId]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, ip_address)
             VALUES ($1, $2, 'receipt_type.enabled', 'receipt_type', $3, $4)`,
            [companyId, req.user.id, typeId, req.ip]
        );

        res.json({ message: "Receipt type enabled." });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to enable receipt type." });
    }
});

router.put("/types/:id/disable", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);

        await pool.query(
            `UPDATE company_receipt_types SET is_enabled = FALSE
             WHERE company_id = $1 AND receipt_type_id = $2`,
            [companyId, typeId]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, ip_address)
             VALUES ($1, $2, 'receipt_type.disabled', 'receipt_type', $3, $4)`,
            [companyId, req.user.id, typeId, req.ip]
        );

        res.json({ message: "Receipt type disabled." });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to disable receipt type." });
    }
});

// ============================================================
// FIELDS — master + custom merged
// ============================================================

// ------------------------------------------------------------
// GET /receipt-config/types/:id/fields
// ------------------------------------------------------------
router.get("/types/:id/fields", async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);

        const master = await pool.query(
            `SELECT id, field_key, field_label, field_type, is_required,
                    options, placeholder, display_order, 'master' AS origin
             FROM receipt_type_fields
             WHERE receipt_type_id = $1
             ORDER BY display_order ASC`,
            [typeId]
        );

        const custom = await pool.query(
            `SELECT id, field_key, field_label, field_type, is_required,
                    options, default_value, placeholder, display_order, 'custom' AS origin
             FROM company_receipt_type_fields
             WHERE company_id = $1 AND receipt_type_id = $2
             ORDER BY display_order ASC`,
            [companyId, typeId]
        );

        res.json({
            master_fields: master.rows,
            custom_fields: custom.rows,
            fields: [...master.rows, ...custom.rows].sort((a,b) => a.display_order - b.display_order),
        });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to load fields." });
    }
});

// ------------------------------------------------------------
// POST /receipt-config/types/:id/fields — add custom field
// ------------------------------------------------------------
router.post("/types/:id/fields", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);

        const {
            field_key, field_label, field_type, is_required,
            options, default_value, placeholder, display_order,
        } = req.body;

        if (!field_label || !field_type) {
            return res.status(400).json({ message: "field_label and field_type are required." });
        }
        if (!VALID_FIELD_TYPES.includes(field_type)) {
            return res.status(400).json({ message: `Invalid field_type: ${field_type}` });
        }

        // Auto-generate a safe field_key if not provided
        const key = (field_key || field_label)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            .slice(0, 80);

        // Check master field doesn't already use this key
        const masterDup = await pool.query(
            `SELECT 1 FROM receipt_type_fields
             WHERE receipt_type_id = $1 AND field_key = $2`,
            [typeId, key]
        );
        if (masterDup.rows.length) {
            return res.status(409).json({ message: `A master field already uses the key "${key}".` });
        }

        const result = await pool.query(
            `INSERT INTO company_receipt_type_fields
                (company_id, receipt_type_id, field_key, field_label, field_type,
                 is_required, options, default_value, placeholder, display_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                companyId, typeId, key, field_label.trim(), field_type,
                !!is_required,
                options ? JSON.stringify(options) : null,
                default_value || null,
                placeholder || null,
                Number.isInteger(display_order) ? display_order : 100,
            ]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'receipt_type.field_added', 'receipt_type', $3, $4, $5)`,
            [companyId, req.user.id, typeId,
             JSON.stringify({ field_key: key, field_label }), req.ip]
        );

        res.status(201).json({ message: "Custom field added.", field: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to add custom field." });
    }
});

// ------------------------------------------------------------
// PUT /receipt-config/types/:id/fields/:fieldId — update custom field
// ------------------------------------------------------------
router.put("/types/:id/fields/:fieldId", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);
        const fieldId = parseInt(req.params.fieldId, 10);

        const {
            field_label, field_type, is_required,
            options, default_value, placeholder, display_order,
        } = req.body;

        if (!field_label || !field_type) {
            return res.status(400).json({ message: "field_label and field_type are required." });
        }
        if (!VALID_FIELD_TYPES.includes(field_type)) {
            return res.status(400).json({ message: `Invalid field_type: ${field_type}` });
        }

        const result = await pool.query(
            `UPDATE company_receipt_type_fields SET
                field_label = $1, field_type = $2, is_required = $3,
                options = $4, default_value = $5, placeholder = $6, display_order = $7
             WHERE id = $8 AND company_id = $9 AND receipt_type_id = $10
             RETURNING *`,
            [
                field_label.trim(), field_type, !!is_required,
                options ? JSON.stringify(options) : null,
                default_value || null,
                placeholder || null,
                Number.isInteger(display_order) ? display_order : 100,
                fieldId, companyId, typeId,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Custom field not found." });
        }

        res.json({ message: "Custom field updated.", field: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to update custom field." });
    }
});

// ------------------------------------------------------------
// DELETE /receipt-config/types/:id/fields/:fieldId
// ------------------------------------------------------------
router.delete("/types/:id/fields/:fieldId", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);
        const fieldId = parseInt(req.params.fieldId, 10);

        const result = await pool.query(
            `DELETE FROM company_receipt_type_fields
             WHERE id = $1 AND company_id = $2 AND receipt_type_id = $3
             RETURNING field_key, field_label`,
            [fieldId, companyId, typeId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Custom field not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, old_values, ip_address)
             VALUES ($1, $2, 'receipt_type.field_deleted', 'receipt_type', $3, $4, $5)`,
            [companyId, req.user.id, typeId,
             JSON.stringify({ field_key: result.rows[0].field_key }), req.ip]
        );

        res.json({ message: "Custom field removed." });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to remove custom field." });
    }
});

// ============================================================
// THEME — per receipt type, falls back to company default
// ============================================================

// ------------------------------------------------------------
// GET /receipt-config/types/:id/theme
// ------------------------------------------------------------
router.get("/types/:id/theme", async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);

        const custom = await getTypeTheme(companyId, typeId);
        const companyTheme = await getCompanyTheme(companyId);

        const base = custom?.base_color || companyTheme.base_color || "#0d6efd";

        const resolved = buildTheme(base, {
            header_text_color: custom?.header_text_color || companyTheme.header_text_color,
            accent_color:      custom?.accent_color      || companyTheme.accent_color,
        });

        res.json({
            is_custom: !!custom,
            base_color: base,
            header_text_color: resolved.header_text_color,
            accent_color: resolved.accent_bg,
            resolved,
            last_used_at: custom?.last_used_at || null,
        });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to load theme." });
    }
});

// ------------------------------------------------------------
// PUT /receipt-config/types/:id/theme
// Body: { base_color, retain_from_last?: true }
//   - If retain_from_last is true, we reuse the existing custom theme's base_color.
//   - Otherwise, we use body.base_color.
// ------------------------------------------------------------
router.put("/types/:id/theme", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const typeId = parseInt(req.params.id, 10);
        const { base_color, retain_from_last } = req.body;

        let finalBase = base_color;

        if (retain_from_last) {
            const existing = await getTypeTheme(companyId, typeId);
            if (existing?.base_color) {
                finalBase = existing.base_color;
            } else {
                const companyTheme = await getCompanyTheme(companyId);
                finalBase = companyTheme.base_color || "#0d6efd";
            }
        }

        if (!finalBase || !/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(finalBase))) {
            return res.status(400).json({ message: "A valid base_color (hex) is required." });
        }

        const resolved = buildTheme(finalBase);

        await pool.query(
            `INSERT INTO company_receipt_type_themes
                (company_id, receipt_type_id, base_color, header_text_color, accent_color, updated_at, last_used_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             ON CONFLICT (company_id, receipt_type_id) DO UPDATE
                SET base_color = $3,
                    header_text_color = $4,
                    accent_color = $5,
                    updated_at = NOW(),
                    last_used_at = NOW()`,
            [companyId, typeId, resolved.base_color, resolved.header_text_color, resolved.accent_bg]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'receipt_type.theme_updated', 'receipt_type', $3, $4, $5)`,
            [companyId, req.user.id, typeId,
             JSON.stringify({ base_color: resolved.base_color }), req.ip]
        );

        res.json({ message: "Theme saved.", theme: resolved });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to save theme." });
    }
});

// ============================================================
// TEMPLATES (unchanged from Phase 6a except we now accept
// custom field snapshots as informational only)
// ============================================================

router.get("/templates", async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const { receipt_type_id } = req.query;

        const params = [companyId];
        let where = "WHERE t.company_id = $1";
        if (receipt_type_id) {
            params.push(parseInt(receipt_type_id, 10));
            where += ` AND t.receipt_type_id = $${params.length}`;
        }

        const result = await pool.query(
            `SELECT t.id, t.name, t.description, t.receipt_type_id,
                    rt.code AS type_code, rt.name AS type_name,
                    t.default_footer, t.default_notes,
                    t.default_field_values, t.is_active,
                    t.created_at, t.updated_at,
                    (SELECT COUNT(*)::int FROM receipt_template_fields WHERE template_id = t.id) AS custom_field_count,
                    (SELECT COUNT(*)::int FROM receipt_template_items  WHERE template_id = t.id) AS default_item_count
             FROM receipt_templates t
             JOIN receipt_types rt ON rt.id = t.receipt_type_id
             ${where}
             ORDER BY t.updated_at DESC`,
            params
        );

        res.json({ templates: result.rows });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to load templates." });
    }
});

// ------------------------------------------------------------
// GET /receipt-config/templates/:id
// ------------------------------------------------------------
router.get("/templates/:id", async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const id = parseInt(req.params.id, 10);

        const tpl = await pool.query(
            `SELECT t.*, rt.code AS type_code, rt.name AS type_name
             FROM receipt_templates t
             JOIN receipt_types rt ON rt.id = t.receipt_type_id
             WHERE t.id = $1 AND t.company_id = $2`,
            [id, companyId]
        );
        if (tpl.rows.length === 0) {
            return res.status(404).json({ message: "Template not found." });
        }

        const customFields = await pool.query(
            `SELECT id, field_key, field_label, field_type, is_required,
                    options, default_value, display_order
             FROM receipt_template_fields
             WHERE template_id = $1
             ORDER BY display_order ASC`,
            [id]
        );

        const items = await pool.query(
            `SELECT id, item_id, item_name, description, quantity, unit_price, display_order
             FROM receipt_template_items
             WHERE template_id = $1
             ORDER BY display_order ASC`,
            [id]
        );

        res.json({
            template: {
                ...tpl.rows[0],
                custom_fields: customFields.rows,
                default_items: items.rows,
            },
        });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to load template." });
    }
});

// ------------------------------------------------------------
// POST /receipt-config/templates — create
// ------------------------------------------------------------
router.post("/templates", requireRole("owner", "admin"), validateTemplate, async (req, res) => {
    const client = await pool.connect();
    try {
        const companyId = req.user.company_id;
        const {
            name,
            description,
            receipt_type_id,
            default_footer,
            default_notes,
            default_field_values,   // object: { field_key: value }
            custom_fields,          // array of { field_key, field_label, field_type, is_required, options, default_value, display_order }
            default_items,          // array of { item_id, item_name, description, quantity, unit_price, display_order }
        } = req.body;

        // Validation
        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Template name is required.", field: "name" });
        }
        if (!receipt_type_id) {
            return res.status(400).json({ message: "Receipt type is required.", field: "receipt_type_id" });
        }

        // Verify receipt type is enabled for this company
        const enabled = await client.query(
            `SELECT 1 FROM company_receipt_types
             WHERE company_id = $1 AND receipt_type_id = $2 AND is_enabled = TRUE`,
            [companyId, receipt_type_id]
        );
        if (enabled.rows.length === 0) {
            return res.status(400).json({
                message: "This receipt type is not enabled for your company. Enable it first.",
            });
        }

        // Validate custom fields
        const validFieldTypes = ["text","number","date","select","currency","checkbox","phone","email","textarea"];
        if (Array.isArray(custom_fields)) {
            for (const f of custom_fields) {
                if (!f.field_key || !f.field_label || !f.field_type) {
                    return res.status(400).json({ message: "Custom fields require field_key, field_label, field_type." });
                }
                if (!validFieldTypes.includes(f.field_type)) {
                    return res.status(400).json({ message: `Invalid field_type: ${f.field_type}` });
                }
            }
        }

        // Validate default items
        if (Array.isArray(default_items)) {
            for (const it of default_items) {
                if (!it.item_name || it.quantity == null || it.unit_price == null) {
                    return res.status(400).json({ message: "Default items require item_name, quantity, unit_price." });
                }
            }
        }

        await client.query("BEGIN");

        const tpl = await client.query(
            `INSERT INTO receipt_templates
                (company_id, receipt_type_id, name, description,
                 default_footer, default_notes, default_field_values, is_active, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $9, $8)
             RETURNING *`,
            [
                companyId,
                receipt_type_id,
                name.trim(),
                description || null,
                default_footer || null,
                default_notes || null,
                JSON.stringify(default_field_values || {}),
                req.user.id,
                req.body.is_active ?? true,
            ]
        );
        const templateId = tpl.rows[0].id;

        // Insert custom fields
        if (Array.isArray(custom_fields)) {
            for (let i = 0; i < custom_fields.length; i++) {
                const f = custom_fields[i];
                await client.query(
                    `INSERT INTO receipt_template_fields
                        (template_id, field_key, field_label, field_type, is_required,
                         options, default_value, display_order)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        templateId,
                        f.field_key.trim(),
                        f.field_label.trim(),
                        f.field_type,
                        !!f.is_required,
                        f.options ? JSON.stringify(f.options) : null,
                        f.default_value || null,
                        f.display_order ?? i,
                    ]
                );
            }
        }

        // Insert default items
        if (Array.isArray(default_items)) {
            for (let i = 0; i < default_items.length; i++) {
                const it = default_items[i];
                await client.query(
                    `INSERT INTO receipt_template_items
                        (template_id, item_id, item_name, description,
                         quantity, unit_price, display_order)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        templateId,
                        it.item_id || null,
                        it.item_name.trim(),
                        it.description || null,
                        Number(it.quantity) || 1,
                        Number(it.unit_price) || 0,
                        it.display_order ?? i,
                    ]
                );
            }
        }

        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'template.created', 'receipt_template', $3, $4, $5)`,
            [companyId, req.user.id, templateId,
             JSON.stringify({ name: name.trim(), type_id: receipt_type_id }), req.ip]
        );

        await client.query("COMMIT");

        res.status(201).json({
            message: "Template created.",
            template: { id: templateId, name: name.trim() },
        });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Create template error:", err);
        res.status(500).json({ message: "Failed to create template." });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// PUT /receipt-config/templates/:id — update (replace children)
// ------------------------------------------------------------
router.put("/templates/:id", requireRole("owner", "admin"), validateTemplate, async (req, res) => {
    const client = await pool.connect();
    try {
        const companyId = req.user.company_id;
        const id = parseInt(req.params.id, 10);

        const exists = await client.query(
            "SELECT id FROM receipt_templates WHERE id = $1 AND company_id = $2",
            [id, companyId]
        );
        if (exists.rows.length === 0) {
            return res.status(404).json({ message: "Template not found." });
        }

        const {
            name,
            description,
            default_footer,
            default_notes,
            default_field_values,
            custom_fields,
            default_items,
            is_active,
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Template name is required.", field: "name" });
        }

        await client.query("BEGIN");

        await client.query(
            `UPDATE receipt_templates SET
                name = $1,
                description = $2,
                default_footer = $3,
                default_notes = $4,
                default_field_values = $5,
                is_active = COALESCE($6, is_active),
                updated_at = NOW()
             WHERE id = $7 AND company_id = $8`,
            [
                name.trim(),
                description || null,
                default_footer || null,
                default_notes || null,
                JSON.stringify(default_field_values || {}),
                typeof is_active === "boolean" ? is_active : null,
                id,
                companyId,
            ]
        );

        // Replace children
        await client.query("DELETE FROM receipt_template_fields WHERE template_id = $1", [id]);
        await client.query("DELETE FROM receipt_template_items  WHERE template_id = $1", [id]);

        if (Array.isArray(custom_fields)) {
            for (let i = 0; i < custom_fields.length; i++) {
                const f = custom_fields[i];
                await client.query(
                    `INSERT INTO receipt_template_fields
                        (template_id, field_key, field_label, field_type, is_required,
                         options, default_value, display_order)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        id,
                        f.field_key.trim(),
                        f.field_label.trim(),
                        f.field_type,
                        !!f.is_required,
                        f.options ? JSON.stringify(f.options) : null,
                        f.default_value || null,
                        f.display_order ?? i,
                    ]
                );
            }
        }

        if (Array.isArray(default_items)) {
            for (let i = 0; i < default_items.length; i++) {
                const it = default_items[i];
                await client.query(
                    `INSERT INTO receipt_template_items
                        (template_id, item_id, item_name, description,
                         quantity, unit_price, display_order)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        id,
                        it.item_id || null,
                        it.item_name.trim(),
                        it.description || null,
                        Number(it.quantity) || 1,
                        Number(it.unit_price) || 0,
                        it.display_order ?? i,
                    ]
                );
            }
        }

        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'template.updated', 'receipt_template', $3, $4, $5)`,
            [companyId, req.user.id, id,
             JSON.stringify({ name: name.trim() }), req.ip]
        );

        await client.query("COMMIT");

        res.json({ message: "Template updated." });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Update template error:", err);
        res.status(500).json({ message: "Failed to update template." });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// DELETE /receipt-config/templates/:id
// ------------------------------------------------------------
router.delete("/templates/:id", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const id = parseInt(req.params.id, 10);

        const result = await pool.query(
            "DELETE FROM receipt_templates WHERE id = $1 AND company_id = $2 RETURNING id, name",
            [id, companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Template not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, old_values, ip_address)
             VALUES ($1, $2, 'template.deleted', 'receipt_template', $3, $4, $5)`,
            [companyId, req.user.id, id,
             JSON.stringify({ name: result.rows[0].name }), req.ip]
        );

        res.json({ message: "Template deleted." });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That field key already exists.' });
        console.error(err);
        res.status(500).json({ message: "Failed to delete template." });
    }
});

module.exports = router;