// ============================================================
// routes/superadmin.js — Super Admin operations
// ============================================================
// Endpoints (all require super_admin):
//   GET    /superadmin/plans
//   GET    /superadmin/companies
//   POST   /superadmin/companies           (create company + owner user)
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
            ownerPassword,
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
        if (!ownerPassword)   missing.push("ownerPassword");
        if (missing.length) {
            return res.status(400).json({
                message: `Missing required fields: ${missing.join(", ")}`,
                code: "MISSING_FIELDS",
                fields: missing,
            });
        }

        if (ownerPassword.length < 6) {
            return res.status(400).json({
                message: "Owner password must be at least 6 characters.",
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
        const hash = await bcrypt.hash(ownerPassword, 10);
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
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                message: "New password must be at least 6 characters.",
            });
        }

        const owner = await pool.query(
            "SELECT id FROM users WHERE company_id = $1 AND role = 'owner' LIMIT 1",
            [companyId]
        );

        if (owner.rows.length === 0) {
            return res.status(404).json({ message: "Owner not found for this company." });
        }

        const hash = await bcrypt.hash(newPassword, 10);

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

        res.json({ message: "Owner password reset." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to reset password." });
    }
});

module.exports = router;
