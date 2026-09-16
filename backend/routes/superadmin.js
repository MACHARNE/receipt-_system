// ============================================================
// routes/superadmin.js — Super Admin operations
// ============================================================
// Endpoints (all require super_admin):
//   GET    /superadmin/plans
//   GET    /superadmin/companies
//   POST   /superadmin/companies           (create company + owner user)
//   GET    /superadmin/companies/:id
//   PUT    /superadmin/companies/:id/settings  (identity / branding)
//   POST   /superadmin/companies/:id/logo
//   GET    /superadmin/companies/:id/logo
//   DELETE /superadmin/companies/:id/logo
//   PUT    /superadmin/companies/:id/plan
//   PUT    /superadmin/companies/:id/status
//   PUT    /superadmin/companies/:id/limits
//   POST   /superadmin/companies/:id/reset-owner-password
// ============================================================

const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const pool = require("../db");
const { requireSuperAdmin } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { generatePassword } = require("../utils/password");

const router = express.Router();

// Every route in this file requires super_admin
router.use(requireSuperAdmin);

// ------------------------------------------------------------
// GET /superadmin/plans — list available plans
// ------------------------------------------------------------
router.get("/plans", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, code, name, price, currency, duration_days,
                    default_max_products, default_max_receipt_items, is_active
             FROM plans
             WHERE is_active = TRUE
             ORDER BY price ASC`
        );
        res.json({ plans: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load plans." });
    }
});

// ------------------------------------------------------------
// GET /superadmin/companies — list all companies
// ------------------------------------------------------------
router.get("/companies", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.abbreviation, c.email, c.phone,
                    c.is_active, c.plan_id, c.plan_started_at, c.plan_expires_at,
                    c.max_products, c.max_receipt_items,
                    p.code AS plan_code, p.name AS plan_name, p.price AS plan_price,
                    (SELECT COUNT(*)::int FROM users WHERE company_id = c.id AND role = 'owner') AS owner_count,
                    (SELECT email FROM users WHERE company_id = c.id AND role = 'owner' LIMIT 1) AS owner_email,
                    c.created_at
             FROM companies c
             LEFT JOIN plans p ON p.id = c.plan_id
             ORDER BY c.created_at DESC`
        );
        res.json({ companies: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load companies." });
    }
});

// ------------------------------------------------------------
// POST /superadmin/companies — create company + first owner
// ------------------------------------------------------------
router.post("/companies", async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            companyName,
            abbreviation,
            planCode,
            maxProducts,        // optional override
            maxReceiptItems,    // optional override
            ownerFullName,
            ownerEmail,
            ownerPassword,      // optional — a strong one is generated when omitted
            companyEmail,       // optional
            companyPhone,       // optional
        } = req.body;

        // ---- Validate required fields ----
        const missing = [];
        if (!companyName)     missing.push("companyName");
        if (!abbreviation)    missing.push("abbreviation");
        if (!planCode)        missing.push("planCode");
        if (!ownerFullName)   missing.push("ownerFullName");
        if (!ownerEmail)      missing.push("ownerEmail");
        if (missing.length) {
            return res.status(400).json({
                message: `Missing required fields: ${missing.join(", ")}`,
                code: "MISSING_FIELDS",
                fields: missing,
            });
        }

        // ---- Owner password: use the admin's, or generate a strong one ----
        // A generated password is returned exactly once, in the response body,
        // so the Super Admin can hand it to the owner. It is never logged and
        // never written to the audit trail.
        let ownerSecret = typeof ownerPassword === "string" ? ownerPassword : "";
        const passwordGenerated = ownerSecret.length === 0;

        if (passwordGenerated) {
            ownerSecret = generatePassword();
        } else if (ownerSecret.length < 8 || Buffer.byteLength(ownerSecret) > 72) {
            return res.status(400).json({
                message: "A password you type in must be at least 8 characters (maximum 72 bytes), or leave it blank to generate a secure one.",
                code: "WEAK_PASSWORD",
            });
        }

        const abbr = abbreviation.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (abbr.length < 2 || abbr.length > 10) {
            return res.status(400).json({
                message: "Abbreviation must be 2–10 letters/numbers, no spaces.",
                code: "BAD_ABBREVIATION",
            });
        }

        // ---- Check duplicates BEFORE transaction ----
        const dupAbbr = await client.query(
            "SELECT id FROM companies WHERE abbreviation = $1",
            [abbr]
        );
        if (dupAbbr.rows.length) {
            return res.status(409).json({
                message: `Abbreviation "${abbr}" is already in use.`,
                code: "ABBR_TAKEN",
                field: "abbreviation",
            });
        }

        const dupEmail = await client.query(
            "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
            [ownerEmail.trim()]
        );
        if (dupEmail.rows.length) {
            return res.status(409).json({
                message: "That owner email is already registered.",
                code: "EMAIL_TAKEN",
                field: "ownerEmail",
            });
        }

        // ---- Fetch plan ----
        const planRes = await client.query(
            "SELECT id, duration_days, default_max_products, default_max_receipt_items FROM plans WHERE code = $1 AND is_active = TRUE",
            [planCode]
        );
        if (planRes.rows.length === 0) {
            return res.status(400).json({
                message: `Unknown or inactive plan code: ${planCode}`,
                code: "BAD_PLAN",
            });
        }
        const plan = planRes.rows[0];

        // ---- Effective limits (override or plan default) ----
        const finalMaxProducts =
            Number.isInteger(maxProducts) && maxProducts > 0
                ? maxProducts
                : plan.default_max_products;

        const finalMaxReceiptItems =
            Number.isInteger(maxReceiptItems) && maxReceiptItems > 0
                ? maxReceiptItems
                : plan.default_max_receipt_items;

        // ---- Begin transaction ----
        await client.query("BEGIN");

        // Insert company
        const companyRes = await client.query(
            `INSERT INTO companies
                (name, abbreviation, email, phone,
                 plan_id, plan_started_at, plan_expires_at,
                 max_products, max_receipt_items, is_active)
             VALUES
                ($1, $2, $3, $4,
                 $5, NOW(), NOW() + ($6 || ' days')::interval,
                 $7, $8, TRUE)
             RETURNING id, name, abbreviation`,
            [
                companyName.trim(),
                abbr,
                companyEmail ? companyEmail.trim() : null,
                companyPhone ? companyPhone.trim() : null,
                plan.id,
                plan.duration_days,
                finalMaxProducts,
                finalMaxReceiptItems,
            ]
        );
        const company = companyRes.rows[0];

        // Insert owner user
        const hash = await bcrypt.hash(ownerSecret, 10);
        const ownerRes = await client.query(
            `INSERT INTO users
                (company_id, full_name, email, password_hash, role, is_active)
             VALUES
                ($1, $2, $3, $4, 'owner', TRUE)
             RETURNING id, full_name, email`,
            [company.id, ownerFullName.trim(), ownerEmail.trim().toLowerCase(), hash]
        );
        const owner = ownerRes.rows[0];

        // Record subscription history
        await client.query(
            `INSERT INTO subscriptions
                (company_id, plan_id, started_at, expires_at, assigned_by)
             VALUES ($1, $2, NOW(), NOW() + ($3 || ' days')::interval, $4)`,
            [company.id, plan.id, plan.duration_days, req.session.userId]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'company.created', 'company', $3, $4, $5)`,
            [
                company.id,
                req.session.userId,
                company.id,
                JSON.stringify({
                    name: company.name,
                    abbreviation: company.abbreviation,
                    plan: planCode,
                    owner_email: owner.email,
                    max_products: finalMaxProducts,
                    max_receipt_items: finalMaxReceiptItems,
                }),
                req.ip,
            ]
        );

        await client.query("COMMIT");

        res.status(201).json({
            message: "Company created and owner account set up.",
            company: {
                id: company.id,
                name: company.name,
                abbreviation: company.abbreviation,
            },
            owner: {
                id: owner.id,
                fullName: owner.full_name,
                email: owner.email,
                // Returned once so it can be handed over. Absent when the admin
                // supplied their own password, since the server never sees it again.
                password: passwordGenerated ? ownerSecret : undefined,
                passwordGenerated,
            },
            limits: {
                maxProducts: finalMaxProducts,
                maxReceiptItems: finalMaxReceiptItems,
            },
        });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Company creation error:", err);
        res.status(500).json({ message: "Failed to create company." });
    } finally {
        client.release();
    }
});

// Upload the company logo immediately after the company has been created.
router.post("/companies/:id/logo", upload.single("logo"), async (req, res, next) => {
    const companyId = parseInt(req.params.id, 10);
    if (!companyId || !req.file) return res.status(400).json({ message: "Choose a company logo to upload." });

    const buffer = req.file.buffer;
    let extension;
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = "png";
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) extension = "jpg";
    else if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") extension = "webp";
    if (!extension) return res.status(400).json({ message: "The file is not a supported image." });

    const logoDirectory = path.join(__dirname, "..", "uploads", "logos");
    const filename = `${companyId}-${randomUUID()}.${extension}`;
    const destination = path.join(logoDirectory, filename);
    try {
        const exists = await pool.query("SELECT id FROM companies WHERE id = $1", [companyId]);
        if (!exists.rows[0]) return res.status(404).json({ message: "Company not found." });
        await fs.mkdir(logoDirectory, { recursive: true });
        await fs.writeFile(destination, buffer, { flag: "wx" });
        await pool.query("UPDATE companies SET logo_path = $1, updated_at = NOW() WHERE id = $2", [filename, companyId]);
        res.json({ message: "Company logo uploaded." });
    } catch (err) {
        await fs.unlink(destination).catch(() => {});
        next(err);
    }
});

// ------------------------------------------------------------
// COMPANY IDENTITY (branding) — platform-managed
// ------------------------------------------------------------
// Companies cannot change their own identity (routes/company.js denies it).
// That makes these endpoints the ONLY way the fields below can ever be set,
// so they must cover every branding column used when rendering a receipt.
// ------------------------------------------------------------
const logoDirectory = path.join(__dirname, "..", "uploads", "logos");

// Text columns a super admin may edit, with their maximum lengths.
const IDENTITY_FIELDS = {
    name: 150, abbreviation: 10, address: 2000, phone: 30, email: 120,
    website: 150, tin: 50, cac_number: 50, receipt_footer: 2000,
};

function badRequest(res, message) {
    return res.status(400).json({ message });
}

// GET /superadmin/companies/:id — full company record for the editor
router.get("/companies/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return badRequest(res, "Invalid company id.");
    try {
        const { rows } = await pool.query(
            `SELECT c.*, p.code AS plan_code, p.name AS plan_name,
                    (SELECT email FROM users WHERE company_id = c.id AND role = 'owner' LIMIT 1) AS owner_email
             FROM companies c
             LEFT JOIN plans p ON p.id = c.plan_id
             WHERE c.id = $1`,
            [id]
        );
        if (!rows[0]) return res.status(404).json({ message: "Company not found." });
        res.json({ company: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load company." });
    }
});

// PUT /superadmin/companies/:id/settings — update company identity / branding
router.put("/companies/:id/settings", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return badRequest(res, "Invalid company id.");

    const body = req.body || {};
    const values = [];
    const assignments = [];

    for (const [key, maxLength] of Object.entries(IDENTITY_FIELDS)) {
        if (!Object.hasOwn(body, key)) continue;
        if (typeof body[key] !== "string") return badRequest(res, `Invalid value for ${key}.`);
        let value = body[key].trim();
        if (value.length > maxLength) return badRequest(res, `${key} must be ${maxLength} characters or fewer.`);

        if (key === "name") {
            if (!value) return badRequest(res, "Company name is required.");
        }
        if (key === "abbreviation") {
            value = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (value.length < 2 || value.length > 10) {
                return badRequest(res, "Abbreviation must be 2–10 letters or numbers, with no spaces.");
            }
        }
        if (key === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return badRequest(res, "Enter a valid company email address.");
        }
        if (key === "website" && value) {
            try {
                if (!["http:", "https:"].includes(new URL(value).protocol)) throw new Error();
            } catch {
                return badRequest(res, "Website must start with http:// or https://");
            }
        }
        values.push(value || null);
        assignments.push(`${key} = $${values.length}`);
    }

    if (Object.hasOwn(body, "default_currency")) {
        const currency = String(body.default_currency || "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) return badRequest(res, "Use a three-letter currency code, for example NGN.");
        values.push(currency);
        assignments.push(`default_currency = $${values.length}`);
    }

    if (Object.hasOwn(body, "header_position")) {
        if (!["left", "center", "right"].includes(body.header_position)) {
            return badRequest(res, "Header position must be left, center or right.");
        }
        values.push(body.header_position);
        assignments.push(`header_position = $${values.length}`);
    }

    if (Object.hasOwn(body, "use_logo_watermark")) {
        if (typeof body.use_logo_watermark !== "boolean") {
            return badRequest(res, "Watermark must be true or false.");
        }
        values.push(body.use_logo_watermark);
        assignments.push(`use_logo_watermark = $${values.length}`);
    }

    if (!assignments.length) return badRequest(res, "No changes were supplied.");

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const before = await client.query("SELECT * FROM companies WHERE id = $1 FOR UPDATE", [id]);
        if (!before.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Company not found." });
        }

        values.push(id);
        const { rows } = await client.query(
            `UPDATE companies SET ${assignments.join(", ")}, updated_at = NOW()
             WHERE id = $${values.length} RETURNING *`,
            values
        );

        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address)
             VALUES ($1, $2, 'company.identity_updated', 'company', $3, $4, $5, $6)`,
            [
                id,
                req.session.userId,
                id,
                JSON.stringify(before.rows[0]),
                JSON.stringify(rows[0]),
                req.ip,
            ]
        );

        await client.query("COMMIT");
        res.json({ message: "Company details saved.", company: rows[0] });
    } catch (err) {
        await client.query("ROLLBACK");
        if (err.code === "23505") {
            return res.status(409).json({ message: "That abbreviation is already used by another company." });
        }
        console.error(err);
        res.status(500).json({ message: "Failed to save company details." });
    } finally {
        client.release();
    }
});

// GET /superadmin/companies/:id/logo — preview the current logo
router.get("/companies/:id/logo", async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return badRequest(res, "Invalid company id.");
    try {
        const { rows } = await pool.query("SELECT logo_path FROM companies WHERE id = $1", [id]);
        if (!rows.length) return res.status(404).json({ message: "Company not found." });
        const filename = rows[0].logo_path;
        if (!filename || filename !== path.basename(filename)) {
            return res.status(404).json({ message: "No logo uploaded." });
        }
        res.set("Cache-Control", "private, no-store");
        res.set("X-Content-Type-Options", "nosniff");
        res.sendFile(filename, { root: logoDirectory, dotfiles: "deny" }, err => { if (err) next(err); });
    } catch (err) { next(err); }
});

// DELETE /superadmin/companies/:id/logo — remove the current logo
router.delete("/companies/:id/logo", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return badRequest(res, "Invalid company id.");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT logo_path FROM companies WHERE id = $1 FOR UPDATE", [id]);
        if (!rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Company not found." });
        }
        const previous = rows[0].logo_path;

        // Nothing to remove: stay idempotent and keep the audit trail clean.
        if (!previous) {
            await client.query("COMMIT");
            return res.json({ message: "This company has no logo to remove." });
        }

        await client.query("UPDATE companies SET logo_path = NULL, updated_at = NOW() WHERE id = $1", [id]);
        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, old_values, ip_address)
             VALUES ($1, $2, 'company.logo_removed', 'company', $3, $4, $5)`,
            [id, req.session.userId, id, JSON.stringify({ logo_path: previous }), req.ip]
        );
        await client.query("COMMIT");
        // Best-effort file cleanup; the database is the source of truth.
        if (previous === path.basename(previous)) {
            await fs.unlink(path.join(logoDirectory, previous)).catch(() => {});
        }
        res.json({ message: "Logo removed." });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.status(500).json({ message: "Failed to remove the logo." });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// PUT /superadmin/companies/:id/plan — change plan
// ------------------------------------------------------------
router.put("/companies/:id/plan", async (req, res) => {
    const client = await pool.connect();
    try {
        const { planCode } = req.body;
        const companyId = parseInt(req.params.id, 10);

        if (!planCode) {
            return res.status(400).json({ message: "planCode is required." });
        }

        const plan = await client.query(
            "SELECT id, duration_days FROM plans WHERE code = $1 AND is_active = TRUE",
            [planCode]
        );
        if (plan.rows.length === 0) {
            return res.status(400).json({ message: "Unknown plan code." });
        }

        await client.query("BEGIN");

        const result = await client.query(
            `UPDATE companies
             SET plan_id = $1,
                 plan_started_at = NOW(),
                 plan_expires_at = NOW() + ($2 || ' days')::interval,
                 updated_at = NOW()
             WHERE id = $3
             RETURNING id, name, plan_id, plan_started_at, plan_expires_at`,
            [plan.rows[0].id, plan.rows[0].duration_days, companyId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Company not found." });
        }

        // Record history
        await client.query(
            `INSERT INTO subscriptions
                (company_id, plan_id, started_at, expires_at, assigned_by, notes)
             VALUES ($1, $2, NOW(), NOW() + ($3 || ' days')::interval, $4, 'Plan changed')`,
            [companyId, plan.rows[0].id, plan.rows[0].duration_days, req.session.userId]
        );

        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'company.plan_changed', 'company', $1, $3, $4)`,
            [companyId, req.session.userId, JSON.stringify({ plan: planCode }), req.ip]
        );

        await client.query("COMMIT");
        res.json({ message: "Plan updated.", company: result.rows[0] });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.status(500).json({ message: "Failed to update plan." });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// PUT /superadmin/companies/:id/status — enable / disable
// ------------------------------------------------------------
router.put("/companies/:id/status", async (req, res) => {
    try {
        const companyId = parseInt(req.params.id, 10);
        const { isActive } = req.body;

        if (typeof isActive !== "boolean") {
            return res.status(400).json({ message: "isActive must be true or false." });
        }

        const result = await pool.query(
            `UPDATE companies SET is_active = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id, name, is_active`,
            [isActive, companyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Company not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'company.status_changed', 'company', $1, $3, $4)`,
            [companyId, req.session.userId, JSON.stringify({ is_active: isActive }), req.ip]
        );

        res.json({ message: "Status updated.", company: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update status." });
    }
});

// ------------------------------------------------------------
// PUT /superadmin/companies/:id/limits — set per-company limits
// ------------------------------------------------------------
router.put("/companies/:id/limits", async (req, res) => {
    try {
        const companyId = parseInt(req.params.id, 10);
        const { maxProducts, maxReceiptItems } = req.body;

        if (
            !Number.isInteger(maxProducts) || maxProducts < 1 ||
            !Number.isInteger(maxReceiptItems) || maxReceiptItems < 1
        ) {
            return res.status(400).json({
                message: "maxProducts and maxReceiptItems must be positive integers.",
            });
        }

        const result = await pool.query(
            `UPDATE companies
             SET max_products = $1, max_receipt_items = $2, updated_at = NOW()
             WHERE id = $3
             RETURNING id, name, max_products, max_receipt_items`,
            [maxProducts, maxReceiptItems, companyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Company not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'company.limits_changed', 'company', $1, $3, $4)`,
            [
                companyId,
                req.session.userId,
                JSON.stringify({ max_products: maxProducts, max_receipt_items: maxReceiptItems }),
                req.ip,
            ]
        );

        res.json({ message: "Limits updated.", company: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update limits." });
    }
});

// ------------------------------------------------------------
// POST /superadmin/companies/:id/reset-owner-password
// ------------------------------------------------------------
router.post("/companies/:id/reset-owner-password", async (req, res) => {
    try {
        const companyId = parseInt(req.params.id, 10);
        if (!Number.isInteger(companyId) || companyId < 1) {
            return res.status(400).json({ message: "Invalid company id." });
        }

        const { newPassword } = req.body;

        // Same rule as company creation: blank means "generate a strong one".
        let secret = typeof newPassword === "string" ? newPassword : "";
        const passwordGenerated = secret.length === 0;

        if (passwordGenerated) {
            secret = generatePassword();
        } else if (secret.length < 8 || Buffer.byteLength(secret) > 72) {
            return res.status(400).json({
                message: "A password you type in must be at least 8 characters (maximum 72 bytes), or leave it blank to generate a secure one.",
            });
        }

        const owner = await pool.query(
            "SELECT id FROM users WHERE company_id = $1 AND role = 'owner' LIMIT 1",
            [companyId]
        );

        if (owner.rows.length === 0) {
            return res.status(404).json({ message: "Owner not found for this company." });
        }

        const hash = await bcrypt.hash(secret, 10);

        await pool.query(
            "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
            [hash, owner.rows[0].id]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, ip_address)
             VALUES ($1, $2, 'user.password_reset_by_admin', 'user', $3, $4)`,
            [companyId, req.session.userId, owner.rows[0].id, req.ip]
        );

        res.json({
            message: passwordGenerated
                ? "A new password has been generated for the owner."
                : "Owner password updated.",
            // Returned once, never logged.
            password: passwordGenerated ? secret : undefined,
            passwordGenerated,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to reset password." });
    }
});

module.exports = router;
