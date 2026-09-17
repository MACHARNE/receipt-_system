// ============================================================
// routes/users.js — The company's own team
// ============================================================
//   GET    /users                       — list
//   POST   /users                       — create an administrator or staff member
//   PUT    /users/:id                   — update
//   POST   /users/:id/reset-password    — set or generate a new password
//
// Owner only. §7.2 gives the Owner "create/manage Admins and Staff", while §7.3
// explicitly denies an Administrator the ability to manage company users.
//
// There is deliberately no DELETE. Users are referenced by receipts they issued
// or voided and by the audit trail, so removing the row would orphan that
// history or fail outright. People who leave are disabled, not erased.
//
// The Owner account itself is created by the platform administrator (§8) and is
// not editable here: it is the account of record for the company.
// ============================================================

const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { requireCompanyUser, requireRole } = require("../middleware/auth");
const { generatePassword } = require("../utils/password");

const router = express.Router();

router.use(requireCompanyUser);

// Roles a company may hand out. 'owner' is excluded: the owner is appointed by
// the platform administrator, and a second owner would make "the account of
// record" ambiguous. 'super_admin' is a platform role and never assignable.
const ASSIGNABLE_ROLES = ["admin", "staff"];

const PUBLIC_COLUMNS = `id, full_name, email, phone, role, is_active, last_login_at, created_at`;

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Validate a password that a person typed in, or generate one.
 * Mirrors the platform administrator flow so the rules are the same everywhere.
 */
function resolvePassword(supplied) {
    const typed = typeof supplied === "string" ? supplied : "";
    if (typed.length === 0) {
        return { password: generatePassword(), generated: true };
    }
    if (typed.length < 8 || Buffer.byteLength(typed) > 72) {
        return {
            error: "A password you type in must be at least 8 characters (maximum 72 bytes), or leave it blank to generate a secure one.",
        };
    }
    return { password: typed, generated: false };
}

// ============================================================
// GET /users — list the team
// ============================================================
router.get("/", requireRole("owner"), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ${PUBLIC_COLUMNS}
             FROM users
             WHERE company_id = $1
             ORDER BY
               CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
               full_name ASC`,
            [req.session.companyId]
        );
        res.json({ users: rows, assignable_roles: ASSIGNABLE_ROLES });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load your team." });
    }
});

// ============================================================
// POST /users — add an administrator or staff member
// ============================================================
router.post("/", requireRole("owner"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const { full_name, email, phone, role } = req.body;

        const name = String(full_name || "").trim();
        if (!name) return res.status(400).json({ message: "A full name is required.", field: "full_name" });
        if (name.length > 120) return res.status(400).json({ message: "That name is too long.", field: "full_name" });

        const cleanEmail = String(email || "").trim().toLowerCase();
        if (!cleanEmail || !isValidEmail(cleanEmail)) {
            return res.status(400).json({ message: "Enter a valid email address.", field: "email" });
        }

        const assignedRole = String(role || "staff").trim().toLowerCase();
        if (!ASSIGNABLE_ROLES.includes(assignedRole)) {
            return res.status(400).json({
                message: `Choose a role of ${ASSIGNABLE_ROLES.join(" or ")}.`,
                field: "role",
            });
        }

        // Email is unique across the whole platform, not just this company.
        const existing = await pool.query(
            "SELECT id FROM users WHERE LOWER(email) = $1", [cleanEmail]);
        if (existing.rows.length) {
            return res.status(409).json({
                message: "That email address is already registered.",
                field: "email",
            });
        }

        const resolved = resolvePassword(req.body.password);
        if (resolved.error) return res.status(400).json({ message: resolved.error, field: "password" });

        const hash = await bcrypt.hash(resolved.password, 10);

        const inserted = await pool.query(
            `INSERT INTO users (company_id, full_name, email, phone, password_hash, role, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             RETURNING ${PUBLIC_COLUMNS}`,
            [companyId, name, cleanEmail, String(phone || "").trim() || null, hash, assignedRole]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'user.created', 'user', $3, $4, $5)`,
            [companyId, req.session.userId, inserted.rows[0].id,
             JSON.stringify({ full_name: name, email: cleanEmail, role: assignedRole }), req.ip]
        );

        res.status(201).json({
            message: "Team member added.",
            user: inserted.rows[0],
            // Shown once so it can be handed over. Never logged, never audited.
            password: resolved.generated ? resolved.password : undefined,
            passwordGenerated: resolved.generated,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to add that team member." });
    }
});

// ============================================================
// PUT /users/:id — update
// ============================================================
router.put("/:id", requireRole("owner"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid id." });

        const existing = await pool.query(
            "SELECT id, role, is_active, full_name FROM users WHERE id = $1 AND company_id = $2",
            [id, companyId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: "That team member was not found." });
        }
        const target = existing.rows[0];

        if (target.role === "owner") {
            return res.status(403).json({
                message: "The owner account is managed by the platform administrator and cannot be changed here.",
            });
        }

        const { full_name, phone, role, is_active } = req.body;

        const name = String(full_name || "").trim();
        if (!name) return res.status(400).json({ message: "A full name is required.", field: "full_name" });

        const assignedRole = String(role || target.role).trim().toLowerCase();
        if (!ASSIGNABLE_ROLES.includes(assignedRole)) {
            return res.status(400).json({
                message: `Choose a role of ${ASSIGNABLE_ROLES.join(" or ")}.`,
                field: "role",
            });
        }

        const active = is_active === undefined ? target.is_active : Boolean(is_active);

        // Guard against locking yourself out of your own account.
        if (id === req.session.userId && !active) {
            return res.status(400).json({ message: "You cannot disable your own account." });
        }

        const updated = await pool.query(
            `UPDATE users SET full_name = $1, phone = $2, role = $3, is_active = $4, updated_at = NOW()
             WHERE id = $5 AND company_id = $6
             RETURNING ${PUBLIC_COLUMNS}`,
            [name, String(phone || "").trim() || null, assignedRole, active, id, companyId]
        );

        const changes = {};
        if (target.role !== assignedRole) changes.role = { from: target.role, to: assignedRole };
        if (target.is_active !== active) changes.is_active = { from: target.is_active, to: active };
        if (target.full_name !== name) changes.full_name = { from: target.full_name, to: name };

        if (Object.keys(changes).length) {
            await pool.query(
                `INSERT INTO audit_logs
                    (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
                 VALUES ($1, $2, 'user.updated', 'user', $3, $4, $5)`,
                [companyId, req.session.userId, id, JSON.stringify(changes), req.ip]
            );
        }

        res.json({ message: "Team member updated.", user: updated.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update that team member." });
    }
});

// ============================================================
// POST /users/:id/reset-password
// ============================================================
router.post("/:id/reset-password", requireRole("owner"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid id." });

        const existing = await pool.query(
            "SELECT id, role, full_name FROM users WHERE id = $1 AND company_id = $2",
            [id, companyId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: "That team member was not found." });
        }
        if (existing.rows[0].role === "owner") {
            return res.status(403).json({
                message: "The owner's password is reset by the platform administrator.",
            });
        }

        const resolved = resolvePassword(req.body.newPassword);
        if (resolved.error) return res.status(400).json({ message: resolved.error });

        const hash = await bcrypt.hash(resolved.password, 10);

        await pool.query(
            "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3",
            [hash, id, companyId]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, ip_address)
             VALUES ($1, $2, 'user.password_reset', 'user', $3, $4)`,
            [companyId, req.session.userId, id, req.ip]
        );

        res.json({
            message: resolved.generated
                ? `A new password has been generated for ${existing.rows[0].full_name}.`
                : "Password updated.",
            password: resolved.generated ? resolved.password : undefined,
            passwordGenerated: resolved.generated,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to reset that password." });
    }
});

module.exports = router;
