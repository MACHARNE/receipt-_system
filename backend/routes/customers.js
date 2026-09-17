// ============================================================
// routes/customers.js — People the company issues receipts to
// ============================================================
// One table serves every business type: students, tenants, patients,
// participants, members, donors. `customer_type` distinguishes them and
// anything specific to one kind of person (a student's class, a tenant's
// property) lives in customer_profiles as key/value pairs, so a new business
// type never needs a schema change.
//
// Endpoints:
//   GET    /customers                     — list with search/filter/pagination
//   GET    /customers/search              — small, fast lookup for the receipt form
//   GET    /customers/:id                 — one record with its attributes
//   POST   /customers                     — create
//   PUT    /customers/:id                 — update
//   DELETE /customers/:id                 — delete
//   GET    /customers/import/template     — download CSV template
//   POST   /customers/import/validate     — dry run (parse + validate only)
//   POST   /customers/import/commit       — insert valid rows
//
// Note: plans cap items and receipt lines, not people. There is no customer
// limit column in the schema, so none is enforced here.
// ============================================================

const express = require("express");
const fs = require("fs");
const pool = require("../db");
const { requireCompanyUser, requireRole } = require("../middleware/auth");
const { uploadImport } = require("../middleware/uploadImport");
const { parse } = require("csv-parse/sync");

const router = express.Router();

router.use(requireCompanyUser);

// ------------------------------------------------------------
// Constants shared with the CSV import
// ------------------------------------------------------------
const CUSTOMER_TYPES = [
    "customer", "student", "tenant", "participant",
    "subscriber", "patient", "member", "donor", "guest",
];

// Columns the importer understands directly.
const KNOWN_COLUMNS = [
    "full_name", "type", "customer_type", "external_ref", "phone", "email", "address", "notes",
];

const MAX_PROFILE_KEY_LENGTH = 80;
const MAX_ROWS = 5000;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function normaliseProfileKey(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, MAX_PROFILE_KEY_LENGTH);
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Every response groups profile rows into a plain object, so the front end
// never has to reassemble them.
const CUSTOMER_SELECT = `
    SELECT c.id, c.customer_type, c.external_ref, c.full_name, c.phone, c.email,
           c.address, c.notes, c.is_active, c.created_at, c.updated_at,
           COALESCE(
               jsonb_object_agg(cp.profile_key, cp.profile_value)
               FILTER (WHERE cp.profile_key IS NOT NULL),
               '{}'::jsonb
           ) AS profiles
    FROM customers c
    LEFT JOIN customer_profiles cp ON cp.customer_id = c.id
`;

async function loadCustomer(companyId, id, db = pool) {
    const { rows } = await db.query(
        `${CUSTOMER_SELECT} WHERE c.company_id = $1 AND c.id = $2 GROUP BY c.id`,
        [companyId, id]
    );
    return rows[0] || null;
}

/** Replace a customer's attributes wholesale, ignoring null/empty values. */
async function replaceProfiles(db, customerId, profiles) {
    await db.query("DELETE FROM customer_profiles WHERE customer_id = $1", [customerId]);
    const entries = Object.entries(profiles || {})
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
    for (const [key, value] of entries) {
        await db.query(
            `INSERT INTO customer_profiles (customer_id, profile_key, profile_value)
             VALUES ($1, $2, $3)`,
            [customerId, key, String(value).trim()]
        );
    }
}

function sanitiseProfiles(input) {
    const out = {};
    if (!input || typeof input !== "object") return out;
    for (const [rawKey, rawValue] of Object.entries(input)) {
        const key = normaliseProfileKey(rawKey);
        if (!key) continue;
        const value = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
        if (!value) continue;
        out[key] = value.slice(0, 500);
    }
    return out;
}

/** Pull the non-column CSV fields out as profile attributes. */
function profilesFromRow(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        if (KNOWN_COLUMNS.includes(String(key).trim().toLowerCase())) continue;
        const profileKey = normaliseProfileKey(key);
        if (!profileKey) continue;
        const text = value === null || value === undefined ? "" : String(value).trim();
        if (!text) continue;
        out[profileKey] = text.slice(0, 500);
    }
    return out;
}

// ============================================================
// GET /customers — list with search, filter, pagination
// ============================================================
// Browsing the address book is for the people who maintain it (§7.3). Staff
// reach a person through /customers/search while issuing a receipt, which §7.4
// allows them to do.
router.get("/", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const { q = "", type, status, page = 1, pageSize = 25 } = req.query;

        const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
        const offset = ((parseInt(page, 10) || 1) - 1) * limit;

        const where = ["c.company_id = $1"];
        const params = [companyId];
        let p = 2;

        if (String(q).trim()) {
            where.push(`(c.full_name ILIKE $${p} OR c.phone ILIKE $${p}
                         OR c.email ILIKE $${p} OR c.external_ref ILIKE $${p})`);
            params.push(`%${String(q).trim()}%`);
            p += 1;
        }
        if (type && CUSTOMER_TYPES.includes(String(type))) {
            where.push(`c.customer_type = $${p}`);
            params.push(String(type));
            p += 1;
        }
        if (status === "active" || status === "inactive") {
            where.push(`c.is_active = $${p}`);
            params.push(status === "active");
            p += 1;
        }

        const whereSql = `WHERE ${where.join(" AND ")}`;

        const countRes = await pool.query(
            `SELECT COUNT(*)::int AS total FROM customers c ${whereSql}`,
            params
        );

        const listRes = await pool.query(
            `${CUSTOMER_SELECT} ${whereSql}
             GROUP BY c.id
             ORDER BY c.full_name ASC
             LIMIT $${p} OFFSET $${p + 1}`,
            [...params, limit, offset]
        );

        const total = countRes.rows[0].total;
        res.json({
            customers: listRes.rows,
            pagination: {
                total,
                page: parseInt(page, 10) || 1,
                pageSize: limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load people." });
    }
});

// ============================================================
// GET /customers/search — lookup for the receipt form
// ============================================================
// Deliberately small and fast: the receipt form calls this as the user types a
// name, and uses the result to fill in their reference, class and contact
// details.
router.get("/search", async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const term = String(req.query.q || "").trim();
        if (term.length < 2) return res.json({ customers: [] });

        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 25);

        const { rows } = await pool.query(
            `${CUSTOMER_SELECT}
             WHERE c.company_id = $1 AND c.is_active = TRUE
               AND (c.full_name ILIKE $2 OR c.external_ref ILIKE $2 OR c.phone ILIKE $2)
             GROUP BY c.id
             ORDER BY
               -- exact-ish matches first, then alphabetical
               CASE WHEN c.full_name ILIKE $3 THEN 0 ELSE 1 END,
               c.full_name ASC
             LIMIT $4`,
            [companyId, `%${term}%`, `${term}%`, limit]
        );

        res.json({ customers: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to search people." });
    }
});

// ============================================================
// GET /customers/:id
// ============================================================
router.get("/:id", requireRole("owner", "admin"), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ message: "Invalid id." });
        }
        const customer = await loadCustomer(req.session.companyId, id);
        if (!customer) return res.status(404).json({ message: "Person not found." });
        res.json({ customer });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load person." });
    }
});

// ============================================================
// POST /customers — create one
// ============================================================
router.post("/", requireRole("owner", "admin"), async (req, res) => {
    const client = await pool.connect();
    try {
        const companyId = req.session.companyId;
        const {
            full_name, customer_type, external_ref, phone, email, address, notes,
            is_active, profiles,
        } = req.body;

        const name = String(full_name || "").trim();
        if (!name) return res.status(400).json({ message: "A name is required.", field: "full_name" });

        const type = String(customer_type || "customer").trim().toLowerCase();
        if (!CUSTOMER_TYPES.includes(type)) {
            return res.status(400).json({
                message: `Type must be one of: ${CUSTOMER_TYPES.join(", ")}.`,
                field: "customer_type",
            });
        }

        const ref = String(external_ref || "").trim() || null;
        if (ref) {
            const dup = await client.query(
                "SELECT id FROM customers WHERE company_id = $1 AND external_ref = $2",
                [companyId, ref]
            );
            if (dup.rows.length) {
                return res.status(409).json({
                    message: `Another person already uses the reference "${ref}".`,
                    field: "external_ref",
                });
            }
        }

        const cleanEmail = String(email || "").trim() || null;
        if (cleanEmail && !isValidEmail(cleanEmail)) {
            return res.status(400).json({ message: "Enter a valid email address.", field: "email" });
        }

        await client.query("BEGIN");

        const inserted = await client.query(
            `INSERT INTO customers
                (company_id, customer_type, external_ref, full_name, phone, email, address, notes, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
                companyId, type, ref, name,
                String(phone || "").trim() || null,
                cleanEmail,
                String(address || "").trim() || null,
                String(notes || "").trim() || null,
                is_active === undefined ? true : Boolean(is_active),
            ]
        );

        const customerId = inserted.rows[0].id;
        await replaceProfiles(client, customerId, sanitiseProfiles(profiles));

        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'customer.created', 'customer', $3, $4, $5)`,
            [companyId, req.session.userId, customerId,
             JSON.stringify({ full_name: name, customer_type: type, external_ref: ref }), req.ip]
        );

        await client.query("COMMIT");

        res.status(201).json({
            message: "Person added.",
            customer: await loadCustomer(companyId, customerId),
        });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.status(500).json({ message: "Failed to add person." });
    } finally {
        client.release();
    }
});

// ============================================================
// PUT /customers/:id — update
// ============================================================
router.put("/:id", requireRole("owner", "admin"), async (req, res) => {
    const client = await pool.connect();
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ message: "Invalid id." });
        }

        const { full_name, customer_type, external_ref, phone, email, address, notes, is_active, profiles } = req.body;

        const name = String(full_name || "").trim();
        if (!name) return res.status(400).json({ message: "A name is required.", field: "full_name" });

        const type = String(customer_type || "customer").trim().toLowerCase();
        if (!CUSTOMER_TYPES.includes(type)) {
            return res.status(400).json({ message: `Type must be one of: ${CUSTOMER_TYPES.join(", ")}.` });
        }

        const ref = String(external_ref || "").trim() || null;
        if (ref) {
            const dup = await client.query(
                "SELECT id FROM customers WHERE company_id = $1 AND external_ref = $2 AND id <> $3",
                [companyId, ref, id]
            );
            if (dup.rows.length) {
                return res.status(409).json({ message: `Another person already uses the reference "${ref}".` });
            }
        }

        const cleanEmail = String(email || "").trim() || null;
        if (cleanEmail && !isValidEmail(cleanEmail)) {
            return res.status(400).json({ message: "Enter a valid email address." });
        }

        await client.query("BEGIN");

        const updated = await client.query(
            `UPDATE customers SET
                customer_type = $1, external_ref = $2, full_name = $3, phone = $4,
                email = $5, address = $6, notes = $7, is_active = $8, updated_at = NOW()
             WHERE id = $9 AND company_id = $10
             RETURNING id`,
            [
                type, ref, name,
                String(phone || "").trim() || null,
                cleanEmail,
                String(address || "").trim() || null,
                String(notes || "").trim() || null,
                is_active === undefined ? true : Boolean(is_active),
                id, companyId,
            ]
        );

        if (updated.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Person not found." });
        }

        await replaceProfiles(client, id, sanitiseProfiles(profiles));

        await client.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, new_values, ip_address)
             VALUES ($1, $2, 'customer.updated', 'customer', $3, $4, $5)`,
            [companyId, req.session.userId, id,
             JSON.stringify({ full_name: name, customer_type: type, external_ref: ref }), req.ip]
        );

        await client.query("COMMIT");

        res.json({ message: "Person updated.", customer: await loadCustomer(companyId, id) });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.status(500).json({ message: "Failed to update person." });
    } finally {
        client.release();
    }
});

// ============================================================
// DELETE /customers/:id
// ============================================================
router.delete("/:id", requireRole("owner", "admin"), async (req, res) => {
    try {
        const companyId = req.session.companyId;
        const id = parseInt(req.params.id, 10);

        const result = await pool.query(
            "DELETE FROM customers WHERE id = $1 AND company_id = $2 RETURNING id, full_name",
            [id, companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Person not found." });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (company_id, user_id, action, entity_type, entity_id, old_values, ip_address)
             VALUES ($1, $2, 'customer.deleted', 'customer', $3, $4, $5)`,
            [companyId, req.session.userId, id,
             JSON.stringify({ full_name: result.rows[0].full_name }), req.ip]
        );

        res.json({ message: "Person deleted." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to delete person." });
    }
});

// ============================================================
// GET /customers/import/template — CSV template
// ============================================================
router.get("/import/template", (req, res) => {
    const csv =
        "full_name,type,external_ref,phone,email,class\n" +
        "Michael Edozie,student,STU-001,08031234567,parent1@example.com,JSS 1\n" +
        "Ada Obi,student,STU-002,08037654321,,JSS 2\n" +
        "Chuka Nwosu,tenant,,08099887766,,Block A\n";

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=people_template.csv");
    res.send(csv);
});

// ============================================================
// Shared row validation for both import steps
// ============================================================
async function validateRows(rows, companyId) {
    const errors = [];
    const valid = [];

    const existingRefs = new Set(
        (await pool.query(
            "SELECT external_ref FROM customers WHERE company_id = $1 AND external_ref IS NOT NULL",
            [companyId]
        )).rows.map(r => r.external_ref)
    );

    const seenRefs = new Set();

    rows.forEach((row, i) => {
        const line = i + 2;   // row 1 is the header
        const name = String(row.full_name || row.name || "").trim();

        if (!name) {
            errors.push({ line, field: "full_name", message: "Missing name" });
            return;
        }
        if (name.length > 150) {
            errors.push({ line, field: "full_name", message: "Name is longer than 150 characters" });
            return;
        }

        const type = String(row.type || row.customer_type || "customer").trim().toLowerCase();
        if (!CUSTOMER_TYPES.includes(type)) {
            errors.push({
                line, field: "type",
                message: `Type must be one of: ${CUSTOMER_TYPES.join(", ")}`,
            });
            return;
        }

        const ref = String(row.external_ref || "").trim() || null;
        if (ref) {
            if (existingRefs.has(ref)) {
                errors.push({ line, field: "external_ref", message: `Reference "${ref}" already exists` });
                return;
            }
            if (seenRefs.has(ref)) {
                errors.push({ line, field: "external_ref", message: `Duplicate reference "${ref}" in this file` });
                return;
            }
            seenRefs.add(ref);
        }

        const email = String(row.email || "").trim() || null;
        if (email && !isValidEmail(email)) {
            errors.push({ line, field: "email", message: "Invalid email address" });
            return;
        }

        valid.push({
            full_name: name,
            customer_type: type,
            external_ref: ref,
            phone: String(row.phone || "").trim() || null,
            email,
            address: String(row.address || "").trim() || null,
            notes: String(row.notes || "").trim() || null,
            profiles: profilesFromRow(row),
        });
    });

    return { valid, errors };
}

async function parseUploadedFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

// ============================================================
// POST /customers/import/validate — dry run
// ============================================================
router.post(
    "/import/validate",
    requireRole("owner", "admin"),
    uploadImport.single("file"),
    async (req, res) => {
        if (!req.file) return res.status(400).json({ message: "No file uploaded." });
        const filePath = req.file.path;

        try {
            let rows;
            try {
                rows = await parseUploadedFile(filePath);
            } catch (parseErr) {
                return res.status(400).json({ message: `Could not read the CSV: ${parseErr.message}` });
            }

            if (rows.length === 0) return res.status(400).json({ message: "The file has no data rows." });
            if (rows.length > MAX_ROWS) {
                return res.status(400).json({ message: `Maximum ${MAX_ROWS.toLocaleString()} rows per import.` });
            }

            const { valid, errors } = await validateRows(rows, req.session.companyId);

            res.json({
                totalRows: rows.length,
                validRows: valid.length,
                errorRows: errors.length,
                errors: errors.slice(0, 200),
                preview: valid.slice(0, 20),
            });
        } catch (err) {
            console.error("Customer import validate error:", err);
            res.status(500).json({ message: "Failed to check the file." });
        } finally {
            fs.unlink(filePath, () => {});
        }
    }
);

// ============================================================
// POST /customers/import/commit — insert valid rows
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
            let rows;
            try {
                rows = await parseUploadedFile(filePath);
            } catch (parseErr) {
                return res.status(400).json({ message: `Could not read the CSV: ${parseErr.message}` });
            }

            if (rows.length === 0) return res.status(400).json({ message: "The file has no data rows." });
            if (rows.length > MAX_ROWS) {
                return res.status(400).json({ message: `Maximum ${MAX_ROWS.toLocaleString()} rows per import.` });
            }

            const { valid, errors } = await validateRows(rows, req.session.companyId);
            if (valid.length === 0) {
                return res.status(400).json({
                    message: "No rows could be imported. Fix the highlighted problems and try again.",
                    errorRows: errors.length,
                    errors: errors.slice(0, 200),
                });
            }

            // Everything in one transaction: a partial import would leave the
            // company half-populated and the user unsure what had been saved.
            await client.query("BEGIN");

            let imported = 0;
            for (const row of valid) {
                const inserted = await client.query(
                    `INSERT INTO customers
                        (company_id, customer_type, external_ref, full_name, phone, email, address, notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     RETURNING id`,
                    [
                        req.session.companyId, row.customer_type, row.external_ref,
                        row.full_name, row.phone, row.email, row.address, row.notes,
                    ]
                );
                await replaceProfiles(client, inserted.rows[0].id, row.profiles);
                imported += 1;
            }

            await client.query(
                `INSERT INTO audit_logs
                    (company_id, user_id, action, entity_type, new_values, ip_address)
                 VALUES ($1, $2, 'customer.imported', 'customer', $3, $4)`,
                [
                    req.session.companyId, req.session.userId,
                    JSON.stringify({ imported, skipped: errors.length, source: "csv" }),
                    req.ip,
                ]
            );

            await client.query("COMMIT");

            res.json({
                message: `${imported} ${imported === 1 ? "person" : "people"} imported.`,
                imported,
                skipped: errors.length,
                errors: errors.slice(0, 200),
            });
        } catch (err) {
            await client.query("ROLLBACK");
            console.error("Customer import commit error:", err);
            res.status(500).json({ message: "Nothing was imported: the file could not be saved. Please try again." });
        } finally {
            client.release();
            fs.unlink(filePath, () => {});
        }
    }
);

module.exports = router;
