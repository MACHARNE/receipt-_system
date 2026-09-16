// ============================================================
// routes/categories.js — Item categories
// ============================================================
// Endpoints:
//   GET    /categories
//   POST   /categories
//   DELETE /categories/:id
// ============================================================

const express = require("express");
const pool = require("../db");
const { requireCompanyUser, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireCompanyUser);

// GET /categories
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.description,
                    (SELECT COUNT(*)::int FROM items WHERE category_id = c.id) AS item_count
             FROM categories c
             WHERE c.company_id = $1
             ORDER BY c.name ASC`,
            [req.session.companyId]
        );
        res.json({ categories: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load categories." });
    }
});

// POST /categories
router.post("/", requireRole("owner", "admin"), async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Category name is required." });
        }

        // Check duplicate
        const dup = await pool.query(
            "SELECT id FROM categories WHERE company_id = $1 AND LOWER(name) = LOWER($2)",
            [req.session.companyId, name.trim()]
        );
        if (dup.rows.length) {
            return res.status(409).json({ message: "A category with that name already exists." });
        }

        const result = await pool.query(
            `INSERT INTO categories (company_id, name, description)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [req.session.companyId, name.trim(), description || null]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'category.created', 'category', $3, $4, $5)`,
            [req.session.companyId, req.session.userId, result.rows[0].id,
             JSON.stringify({ name: name.trim() }), req.ip]
        );

        res.status(201).json({ message: "Category created.", category: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create category." });
    }
});

// DELETE /categories/:id
router.delete("/:id", requireRole("owner", "admin"), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);

        // Don't allow deletion if items still use it
        const inUse = await pool.query(
            "SELECT COUNT(*)::int AS n FROM items WHERE category_id = $1 AND company_id = $2",
            [id, req.session.companyId]
        );
        if (inUse.rows[0].n > 0) {
            return res.status(409).json({
                message: `Cannot delete: ${inUse.rows[0].n} item(s) still use this category.`,
            });
        }

        const result = await pool.query(
            "DELETE FROM categories WHERE id = $1 AND company_id = $2 RETURNING id, name",
            [id, req.session.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Category not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, old_values, ip_address)
             VALUES ($1, $2, 'category.deleted', 'category', $3, $4, $5)`,
            [req.session.companyId, req.session.userId, id,
             JSON.stringify({ name: result.rows[0].name }), req.ip]
        );

        res.json({ message: "Category deleted." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to delete category." });
    }
});

module.exports = router;