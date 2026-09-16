// ============================================================
// routes/auth.js — Authentication
// ============================================================
// Endpoints:
//   POST /auth/login     — email + password → session
//   POST /auth/logout    — destroy session
//   GET  /auth/me        — return current session user
// ============================================================

const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { requireLogin } = require("../middleware/auth");
const router = express.Router();

// ------------------------------------------------------------
// POST /auth/login
// ------------------------------------------------------------
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Validate presence
        if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || Buffer.byteLength(password) > 72) {
            return res.status(400).json({
                message: "Email and password are required.",
                code: "MISSING_FIELDS",
            });
        }

        // 2. Fetch user (case-insensitive email match)
        const result = await pool.query(
            `SELECT id, company_id, full_name, email, password_hash, role, is_active
             FROM users
             WHERE LOWER(email) = LOWER($1)`,
            [email.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password.",
                code: "INVALID_CREDENTIALS",
            });
        }

        const user = result.rows[0];

        // 3. Block disabled accounts
        if (!user.is_active) {
            return res.status(403).json({
                message: "This account has been disabled. Contact support.",
                code: "ACCOUNT_DISABLED",
            });
        }

        // 4. Compare password
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({
                message: "Invalid email or password.",
                code: "INVALID_CREDENTIALS",
            });
        }

        // 5. If company user, verify company is active and plan not expired
        if (user.role !== "super_admin" && user.company_id) {
            const company = await pool.query(
                `SELECT is_active, plan_expires_at
                 FROM companies WHERE id = $1`,
                [user.company_id]
            );

            if (company.rows.length === 0) {
                return res.status(403).json({
                    message: "Your company account is not set up correctly.",
                    code: "COMPANY_MISSING",
                });
            }

            if (!company.rows[0].is_active) {
                return res.status(403).json({
                    message: "Your company account has been disabled.",
                    code: "COMPANY_DISABLED",
                });
            }

            if (
                company.rows[0].plan_expires_at &&
                new Date(company.rows[0].plan_expires_at) < new Date()
            ) {
                return res.status(402).json({
                    message: "Your subscription has expired. Please contact support to renew.",
                    code: "PLAN_EXPIRED",
                });
            }
        }

        // 6. Update last_login_at
        await pool.query(
            "UPDATE users SET last_login_at = NOW() WHERE id = $1",
            [user.id]
        );

        // Rotate the session ID after authentication.
        await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
        // 7. Store session
        req.session.userId    = user.id;
        req.session.companyId = user.company_id || null;
        req.session.role      = user.role;
        req.session.fullName  = user.full_name;

        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
        // 8. Where should the client go?
        const redirect =
            user.role === "super_admin"
                ? "/superadmin-dashboard.html"
                : "/dashboard.html";

        res.json({
            message: "Login successful.",
            redirect,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                companyId: user.company_id,
            },
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({
            message: "Login failed due to a server error.",
            code: "SERVER_ERROR",
        });
    }
});

// ------------------------------------------------------------
// POST /auth/logout
// ------------------------------------------------------------
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({ message: "Already logged out." });
    }
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).json({ message: "Logout failed." });
        }
        res.clearCookie("receipt.sid");
        res.json({ message: "Logged out." });
    });
});

// ------------------------------------------------------------
// GET /auth/me — who am I?
// ------------------------------------------------------------
router.get("/me", requireLogin, (req, res) => res.json({ user: req.user }));

module.exports = router;
