// ============================================================
// routes/items.js — Item/service catalog with CSV import
// ============================================================
// Endpoints:
//   GET    /items                     — list with search/filter/pagination
//   POST   /items                     — create one
//   PUT    /items/:id                 — update
//   DELETE /items/:id                 — delete
//   GET    /items/import/template     — download CSV template
//   POST   /items/import/validate     — dry run (parse + validate only)
//   POST   /items/import/commit       — insert valid rows
// ============================================================

const express = require("express");
const fs = require("fs");
const pool = require("../db");
const { requireCompanyUser, requireRole } = require("../middleware/auth");
const { uploadImport } = require("../middleware/uploadImport");
const { parse } = require("csv-parse/sync");

const router = express.Router();

router.use(requireCompanyUser);

// ============================================================
// Helpers
// ============================================================

// Fetch the company's product limit
async function getLimit(companyId) {
    const r = await pool.query(
        "SELECT max_products FROM companies WHERE id = $1",
        [companyId]
    );
    return r.rows[0]?.max_products ?? 0;
}

async function currentCount(companyId) {
    const r = await pool.query(
        "SELECT COUNT(*)::int AS n FROM items WHERE company_id = $1",
        [companyId]
    );
    return r.rows[0].n;
}

// Parse & validate CSV rows. Returns { valid, errors }.
async function validateRows(rows, companyId) {
    const errors = [];
    const valid = [];

    // Cache of existing SKUs (if provided) to detect duplicates
    const existingSkus = new Set(
        (await pool.query(
            "SELECT sku FROM items WHERE company_id = $1 AND sku IS NOT NULL",
            [companyId]
        )).rows.map(r => r.sku)
    );

    const seenSkusInFile = new Set();
    const seenNamesLower = new Set();

    rows.forEach((row, i) => {
        const line = i + 2;   // +2 because line 1 is the header in Excel
        const name = (row.name || "").trim();
        const priceRaw = (row.default_price || row.price || "").toString().trim();
        const sku = (row.sku || "").trim();
        const status = (row.status || "active").trim().toLowerCase();

        // Required
        if (!name) {
            errors.push({ line, field: "name", message: "Missing item name" });
            return;
        }

        // Price
        const price = Number(priceRaw.replace(/,/g, ""));
        if (priceRaw === "" || isNaN(price) || price < 0) {
            errors.push({ line, field: "default_price", message: "Invalid or missing price" });
            return;
        }

        // Status
        if (!["active", "inactive"].includes(status)) {
            errors.push({ line, field: "status", message: "status must be 'active' or 'inactive'" });
            return;
        }

        // Duplicate SKU
        if (sku) {
            if (existingSkus.has(sku)) {
                errors.push({ line, field: "sku", message: `SKU "${sku}" already exists` });
                return;
            }
            if (seenSkusInFile.has(sku)) {
                errors.push({ line, field: "sku", message: `Duplicate SKU "${sku}" in file` });
                return;
            }
            seenSkusInFile.add(sku);
        }

        // Duplicate name within file
        if (seenNamesLower.has(name.toLowerCase())) {
            errors.push({ line, field: "name", message: `Duplicate name "${name}" in file` });
            return;
        }
        seenNamesLower.add(name.toLowerCase());

        valid.push({
            name,
            description: (row.description || "").trim() || null,
            default_price: price,
            sku: sku || null,
            status,
        });
    });

    return { valid, errors };
}

// ============================================================
// GET /items — list with search, filter, pagination
// ============================================================
router.get("/", async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const {
            q = "",
            category_id,
            status,
            page = 1,
            pageSize = 25,
        } = req.query;

        const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
        const offset = ((parseInt(page, 10) || 1) - 1) * limit;

        const where = ["i.company_id = $1"];
        const params = [companyId];
        let p = 2;

        if (q.trim()) {
            where.push(`(i.name ILIKE $${p} OR i.description ILIKE $${p} OR i.sku ILIKE $${p})`);
            params.push(`%${q.trim()}%`);
            p++;
        }
        if (category_id) {
            where.push(`i.category_id = $${p}`);
            params.push(parseInt(category_id, 10));
            p++;
        }
        if (status && ["active", "inactive"].includes(status)) {
            where.push(`i.status = $${p}`);
            params.push(status);
            p++;
        }

        const whereSql = "WHERE " + where.join(" AND ");

        const countRes = await pool.query(
            `SELECT COUNT(*)::int AS total FROM items i ${whereSql}`,
            params
        );

        const listRes = await pool.query(
            `SELECT i.id, i.name, i.description, i.default_price, i.sku, i.status,
                    i.category_id, c.name AS category_name,
                    i.created_at, i.updated_at
             FROM items i
             LEFT JOIN categories c ON c.id = i.category_id
             ${whereSql}
             ORDER BY i.created_at DESC
             LIMIT $${p} OFFSET $${p + 1}`,
            [...params, limit, offset]
        );

        const total = countRes.rows[0].total;
        const max = await getLimit(companyId);
        const used = await currentCount(companyId);

        res.json({
            items: listRes.rows,
            pagination: {
                total,
                page: parseInt(page, 10) || 1,
                pageSize: limit,
                totalPages: Math.ceil(total / limit),
            },
            usage: { used, max, remaining: Math.max(0, max - used) },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load items." });
    }
});

// ============================================================
// POST /items — create one
// ============================================================
router.post("/", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const { name, description, default_price, sku, category_id, status } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Item name is required.", field: "name" });
        }

        const price = Number(default_price);
        if (isNaN(price) || price < 0) {
            return res.status(400).json({ message: "Price must be a positive number.", field: "default_price" });
        }

        const finalStatus = (status || "active").toLowerCase();
        if (!["active", "inactive"].includes(finalStatus)) {
            return res.status(400).json({ message: "Status must be active or inactive." });
        }

        // ---- ENFORCE PLAN LIMIT ----
        const max = await getLimit(companyId);
        const used = await currentCount(companyId);
        if (used >= max) {
            return res.status(403).json({
                message: `Your plan allows only ${max} items. You currently have ${used}. Contact support to increase your limit.`,
                code: "PLAN_LIMIT_REACHED",
                usage: { used, max },
            });
        }

        // Duplicate SKU
        if (sku && sku.trim()) {
            const dup = await pool.query(
                "SELECT id FROM items WHERE company_id = $1 AND sku = $2",
                [companyId, sku.trim()]
            );
            if (dup.rows.length) {
                return res.status(409).json({ message: "An item with that SKU already exists.", field: "sku" });
            }
        }

        const result = await pool.query(
            `INSERT INTO items
                (company_id, name, description, default_price, sku, category_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                companyId,
                name.trim(),
                description || null,
                price,
                sku ? sku.trim() : null,
                category_id || null,
                finalStatus,
            ]
        );

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'item.created', 'item', $3, $4, $5)`,
            [companyId, req.session.userId, result.rows[0].id,
             JSON.stringify({ name: name.trim(), price }), req.ip]
        );

        res.status(201).json({ message: "Item created.", item: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create item." });
    }
});

// ============================================================
// PUT /items/:id — update
// ============================================================
router.put("/:id", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);
        const { name, description, default_price, sku, category_id, status } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Item name is required.", field: "name" });
        }
        const price = Number(default_price);
        if (isNaN(price) || price < 0) {
            return res.status(400).json({ message: "Price must be a positive number.", field: "default_price" });
        }

        const finalStatus = (status || "active").toLowerCase();
        if (!["active", "inactive"].includes(finalStatus)) {
            return res.status(400).json({ message: "Status must be active or inactive." });
        }

        // Duplicate SKU check (excluding self)
        if (sku && sku.trim()) {
            const dup = await pool.query(
                "SELECT id FROM items WHERE company_id = $1 AND sku = $2 AND id <> $3",
                [companyId, sku.trim(), id]
            );
            if (dup.rows.length) {
                return res.status(409).json({ message: "Another item already uses that SKU.", field: "sku" });
            }
        }

        const result = await pool.query(
            `UPDATE items SET
                name = $1, description = $2, default_price = $3, sku = $4,
                category_id = $5, status = $6, updated_at = NOW()
             WHERE id = $7 AND company_id = $8
             RETURNING *`,
            [
                name.trim(),
                description || null,
                price,
                sku ? sku.trim() : null,
                category_id || null,
                finalStatus,
                id,
                companyId,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Item not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'item.updated', 'item', $3, $4, $5)`,
            [companyId, req.session.userId, id, JSON.stringify(req.body), req.ip]
        );

        res.json({ message: "Item updated.", item: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update item." });
    }
});

// ============================================================
// DELETE /items/:id
// ============================================================
router.delete("/:id", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);

        const result = await pool.query(
            "DELETE FROM items WHERE id = $1 AND company_id = $2 RETURNING id, name",
            [id, companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Item not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, old_values, ip_address)
             VALUES ($1, $2, 'item.deleted', 'item', $3, $4, $5)`,
            [companyId, req.session.userId, id,
             JSON.stringify({ name: result.rows[0].name }), req.ip]
        );

        res.json({ message: "Item deleted." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to delete item." });
    }
});

// ============================================================
// GET /items/import/template — CSV template
// ============================================================
router.get("/import/template", (req, res) => {
    const csv =
        "name,description,default_price,sku,status\n" +
        "Tuition Fee,First term tuition,50000,TUI-001,active\n" +
        "ICT Fee,ICT lab access,5000,ICT-001,active\n";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=items_template.csv");
    res.send(csv);
});

// ============================================================
// POST /items/import/validate — dry run
// ============================================================
router.post(
    "/import/validate",
    requireRole("owner", "admin"),
    uploadImport.single("file"),
    async (req, res) => {
        if (!req.file) return res.status(400).json({ message: "No file uploaded." });

        const filePath = req.file.path;
        try {
            const raw = fs.readFileSync(filePath, "utf8");
            let rows;
            try {
                rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
            } catch (parseErr) {
                return res.status(400).json({
                    message: "Could not parse CSV: " + parseErr.message,
                });
            }

            if (rows.length === 0) {
                return res.status(400).json({ message: "The file contains no data rows." });
            }
            if (rows.length > 5000) {
                return res.status(400).json({ message: "Maximum 5,000 rows per import." });
            }

            const companyId = req.session.companyId;
            const { valid, errors } = await validateRows(rows, companyId);

            // Check plan limit against the *would-be* total
            const max = await getLimit(companyId);
            const used = await currentCount(companyId);
            const projected = used + valid.length;
            const limitExceeded = projected > max;

            res.json({
                totalRows: rows.length,
                validRows: valid.length,
                errorRows: errors.length,
                errors: errors.slice(0, 200),    // cap output
                usage: {
                    used,
                    max,
                    projected,
                    remaining: Math.max(0, max - used),
                    limitExceeded,
                },
                preview: valid.slice(0, 20),
            });
        } catch (err) {
            console.error("CSV validate error:", err);
            res.status(500).json({ message: "Failed to validate file." });
        } finally {
            fs.unlink(filePath, () => {});
        }
    }
);

// ============================================================
// POST /items/import/commit — actual insert
// ============================================================
router.post(
    "/import/commit",
    requireRole("owner", "admin"),
    uploadImport.single("file"),
    async (req, res) => {
        if (!req.file) return res.status(400).json({ message: "No file uploaded." });

        const filePath = req.file.path;
        const client = await pool.connect();

        try {
            const raw = fs.readFileSync(filePath, "utf8");
            const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

            if (rows.length === 0) {
                return res.status(400).json({ message: "The file contains no data rows." });
            }
            if (rows.length > 5000) {
                return res.status(400).json({ message: "Maximum 5,000 rows per import." });
            }

            const companyId = req.session.companyId;
            const { valid, errors } = await validateRows(rows, companyId);

            const max = await getLimit(companyId);
            const used = await currentCount(companyId);
            const projected = used + valid.length;

            if (projected > max) {
                return res.status(403).json({
                    message: `This import would exceed your item limit of ${max}. ` +
                             `You currently have ${used}. Reduce the file or contact support to increase your limit.`,
                    code: "PLAN_LIMIT_REACHED",
                    usage: { used, max, projected },
                });
            }

            // Insert valid rows in a transaction
            await client.query("BEGIN");

            const insertSql = `
                INSERT INTO items
                    (company_id, name, description, default_price, sku, status)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;

            for (const row of valid) {
                await client.query(insertSql, [
                    companyId,
                    row.name,
                    row.description,
                    row.default_price,
                    row.sku,
                    row.status,
                ]);
            }

            // Log the import job
            const job = await client.query(
                `INSERT INTO import_jobs
                    (company_id, import_type, file_name, total_rows, success_rows, failed_rows,
                     status, error_report, created_by, completed_at)
                 VALUES ($1, 'items', $2, $3, $4, $5, 'completed', $6, $7, NOW())
                 RETURNING id`,
                [
                    companyId,
                    req.file.originalname,
                    rows.length,
                    valid.length,
                    errors.length,
                    JSON.stringify(errors.slice(0, 500)),
                    req.session.userId,
                ]
            );

            await client.query(
                `INSERT INTO audit_logs
                    (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
                 VALUES ($1, $2, 'items.imported', 'import_job', $3, $4, $5)`,
                [
                    companyId,
                    req.session.userId,
                    job.rows[0].id,
                    JSON.stringify({ success: valid.length, failed: errors.length }),
                    req.ip,
                ]
            );

            await client.query("COMMIT");

            res.json({
                message: `${valid.length} item(s) imported.`,
                importJobId: job.rows[0].id,
                success: valid.length,
                failed: errors.length,
                errors: errors.slice(0, 200),
            });
        } catch (err) {
            await client.query("ROLLBACK");
            console.error("CSV commit error:", err);
            res.status(500).json({ message: "Failed to import file." });
        } finally {
            client.release();
            fs.unlink(filePath, () => {});
        }
    }
);

module.exports = router;