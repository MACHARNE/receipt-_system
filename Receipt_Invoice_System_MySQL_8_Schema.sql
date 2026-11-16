-- Run on MySQL 8.0.16 or newer in a selected, empty database.
-- Example: CREATE DATABASE receipt_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--          USE receipt_system;
-- Timestamps are stored as UTC DATETIME(6); set/interpret UTC in the application.
-- This source ended mid-super-admin INSERT. Create the first admin in the application
-- with a freshly generated password hash; no incomplete INSERT is included here.
-- Session table retains the source column names; configure a custom MySQL session adapter
-- or replace it with the schema required by your selected MySQL session package.
-- CHECK constraints need MySQL 8.0.16+ to be enforced.
-- Application rules (company scoping, plan limits, receipt numbering) remain in backend code.

-- ============================================================
-- MULTI-PURPOSE RECEIPT, INVOICE & PAYMENT MANAGEMENT SYSTEM
-- MySQL 8.0.16+ Schema — Version 1.3
-- ============================================================



-- ============================================================
-- SECTION 1: PLATFORM ADMINISTRATION
-- ============================================================

-- ------------------------------------------------------------
-- 1.1 PLANS — Subscription tiers managed by Super Admin
-- ------------------------------------------------------------
CREATE TABLE plans (
    id                          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code                        VARCHAR(20) UNIQUE NOT NULL,   -- 'monthly' | 'yearly'
    name                        VARCHAR(50) NOT NULL,
    price                       DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency                    VARCHAR(3) NOT NULL DEFAULT 'NGN',
    duration_days               INT NOT NULL,                  -- 30 | 365
    default_max_products        INT NOT NULL DEFAULT 50,       -- suggestion only
    default_max_receipt_items   INT NOT NULL DEFAULT 10,       -- suggestion only
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 1.2 COMPANIES — Tenant root. Everything scopes to company_id
-- ------------------------------------------------------------
CREATE TABLE companies (
    id                      INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name                    VARCHAR(150) NOT NULL,
    abbreviation            VARCHAR(10) UNIQUE,                -- e.g. 'IDK' for receipt numbers
    logo_path               TEXT,
    use_logo_watermark      BOOLEAN NOT NULL DEFAULT FALSE,
    address                 TEXT,
    phone                   VARCHAR(30),
    email                   VARCHAR(120),
    website                 VARCHAR(150),
    tin                     VARCHAR(50),                       -- Tax Identification Number
    cac_number              VARCHAR(50),                       -- CAC registration number
    default_currency        VARCHAR(3) NOT NULL DEFAULT 'NGN',
    receipt_footer          TEXT,
    header_position         VARCHAR(10) NOT NULL DEFAULT 'left'
                            CHECK (header_position IN ('left','center','right')),

    -- PLAN + LIMITS (authoritative per-company values, set by Super Admin)
    plan_id                 INT ,
    plan_started_at         DATETIME(6),
    plan_expires_at         DATETIME(6),
    max_products            INT NOT NULL DEFAULT 50,           -- overrides plan default
    max_receipt_items       INT NOT NULL DEFAULT 10,           -- overrides plan default
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_companies_plan ON companies(plan_id);
CREATE INDEX idx_companies_active ON companies(is_active);

-- ------------------------------------------------------------
-- 1.3 USERS — Super Admin (company_id NULL) + company users
-- ------------------------------------------------------------
CREATE TABLE users (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT ,   -- NULL for super_admin
    full_name       VARCHAR(120) NOT NULL,
    email           VARCHAR(120) UNIQUE NOT NULL,
    phone           VARCHAR(30),
    password_hash   TEXT NOT NULL,
    role            VARCHAR(20) NOT NULL
                    CHECK (role IN ('super_admin','owner','admin','staff')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   DATETIME(6),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_role ON users(role);

-- ------------------------------------------------------------
-- 1.4 SESSIONS — source structure adapted to MySQL; check middleware schema
-- ------------------------------------------------------------
CREATE TABLE session (
    sid     VARCHAR(255) NOT NULL,
    sess    JSON NOT NULL,
    expire  TIMESTAMP(6) NOT NULL,
    CONSTRAINT session_pkey PRIMARY KEY (sid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_session_expire ON session(expire);

-- ------------------------------------------------------------
-- 1.5 SUBSCRIPTIONS — history of plan assignments per company
-- ------------------------------------------------------------
CREATE TABLE subscriptions (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT NOT NULL ,
    plan_id         INT NOT NULL ,
    started_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at      DATETIME(6) NOT NULL,
    assigned_by     INT ,
    notes           TEXT,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_subscriptions_company ON subscriptions(company_id);


-- ============================================================
-- SECTION 2: RECEIPT CONFIGURATION (MASTER + COMPANY-LEVEL)
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 RECEIPT TYPES — master list, platform-seeded
-- ------------------------------------------------------------
CREATE TABLE receipt_types (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(50) UNIQUE NOT NULL,   -- 'school_fees','sales','rent'
    name            VARCHAR(100) NOT NULL,         -- 'School Fees Receipt'
    description     TEXT,
    icon            VARCHAR(50),                   -- bootstrap icon class
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2.2 RECEIPT TYPE FIELDS — master field definitions per type
-- ------------------------------------------------------------
CREATE TABLE receipt_type_fields (
    id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    receipt_type_id     INT NOT NULL ,
    field_key           VARCHAR(80) NOT NULL,      -- 'student_id'
    field_label         VARCHAR(120) NOT NULL,     -- 'Student ID'
    field_type          VARCHAR(30) NOT NULL
                        CHECK (field_type IN ('text','number','date','select','currency','checkbox','phone','email','textarea')),
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    options             JSON,                     -- for select fields
    placeholder         VARCHAR(150),
    display_order       INT NOT NULL DEFAULT 0,
    UNIQUE (receipt_type_id, field_key),
    FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_type_fields_type ON receipt_type_fields(receipt_type_id);

-- ------------------------------------------------------------
-- 2.3 COMPANY RECEIPT TYPES — which types each company uses
-- ------------------------------------------------------------
CREATE TABLE company_receipt_types (
    id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id          INT NOT NULL ,
    receipt_type_id     INT NOT NULL ,
    is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (company_id, receipt_type_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_company_rt_company ON company_receipt_types(company_id);

-- ------------------------------------------------------------
-- 2.4 RECEIPT TEMPLATES — company-saved reusable templates
-- ------------------------------------------------------------
CREATE TABLE receipt_templates (
    id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id          INT NOT NULL ,
    receipt_type_id     INT NOT NULL ,
    name                VARCHAR(150) NOT NULL,      -- 'JSS First Term Fees'
    description         TEXT,
    default_footer      TEXT,
    default_notes       TEXT,
    default_field_values JSON DEFAULT ('{}'),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          INT ,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_templates_company ON receipt_templates(company_id);
CREATE INDEX idx_templates_type ON receipt_templates(receipt_type_id);

-- ------------------------------------------------------------
-- 2.5 RECEIPT TEMPLATE FIELDS — custom fields added per template
-- ------------------------------------------------------------
CREATE TABLE receipt_template_fields (
    id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    template_id         INT NOT NULL ,
    field_key           VARCHAR(80) NOT NULL,
    field_label         VARCHAR(120) NOT NULL,
    field_type          VARCHAR(30) NOT NULL,
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    options             JSON,
    default_value       TEXT,
    display_order       INT NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES receipt_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_template_fields_template ON receipt_template_fields(template_id);

-- ------------------------------------------------------------
-- 2.6 RECEIPT TEMPLATE DEFAULT ITEMS — pre-fill items on new receipt
-- ------------------------------------------------------------
CREATE TABLE receipt_template_items (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    template_id     INT NOT NULL ,
    item_id         INT,                        -- references items(id), FK added later
    item_name       VARCHAR(150) NOT NULL,
    description     TEXT,
    quantity        DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
    display_order   INT NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES receipt_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_template_items_template ON receipt_template_items(template_id);


-- ============================================================
-- SECTION 3: BUSINESS DATA (CATALOG + CUSTOMERS)
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 CATEGORIES — for grouping items
-- ------------------------------------------------------------
CREATE TABLE categories (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT NOT NULL ,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_categories_company ON categories(company_id);

-- ------------------------------------------------------------
-- 3.2 ITEMS — products/services catalog (max = companies.max_products)
-- ------------------------------------------------------------
CREATE TABLE items (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT NOT NULL ,
    category_id     INT ,
    name            VARCHAR(150) NOT NULL,
    description     TEXT,
    default_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
    sku             VARCHAR(50),
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive')),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_items_company ON items(company_id);
CREATE INDEX idx_items_status ON items(status);
CREATE FULLTEXT INDEX idx_items_name_search ON items(name);

-- Now add FK from receipt_template_items → items
ALTER TABLE receipt_template_items
    ADD CONSTRAINT fk_template_items_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3.3 CUSTOMERS — reusable payer records (customers/students/tenants)
-- ------------------------------------------------------------
CREATE TABLE customers (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT NOT NULL ,
    customer_type   VARCHAR(30) NOT NULL DEFAULT 'customer'
                    CHECK (customer_type IN ('customer','student','tenant','participant','subscriber','patient','member','donor','guest')),
    external_ref    VARCHAR(100),                -- student ID, tenant code, etc.
    full_name       VARCHAR(150) NOT NULL,
    phone           VARCHAR(30),
    email           VARCHAR(120),
    address         TEXT,
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_customers_company ON customers(company_id);
CREATE INDEX idx_customers_type ON customers(customer_type);
CREATE INDEX idx_customers_ref ON customers(company_id, external_ref);
CREATE FULLTEXT INDEX idx_customers_name_search ON customers(full_name);

-- ------------------------------------------------------------
-- 3.4 CUSTOMER PROFILES — EAV for type-specific attributes
--     (student: class, term, session; tenant: property, unit)
-- ------------------------------------------------------------
CREATE TABLE customer_profiles (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL ,
    profile_key     VARCHAR(80) NOT NULL,       -- 'class','term','property','unit'
    profile_value   TEXT,
    UNIQUE (customer_id, profile_key)           -- one value per attribute per person,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_customer_profiles_customer ON customer_profiles(customer_id);
CREATE INDEX idx_customer_profiles_key ON customer_profiles(profile_key);


-- ============================================================
-- SECTION 4: RECEIPT COUNTERS (for ABBR-YYYY-NNNNN numbering)
-- ============================================================

-- ------------------------------------------------------------
-- 4.1 RECEIPT COUNTERS — atomic sequence per company/year/type
-- ------------------------------------------------------------
CREATE TABLE receipt_counters (
    company_id      INT NOT NULL ,
    `year`            INT NOT NULL,
    receipt_type_id INT NOT NULL ,
    last_number     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, `year`, receipt_type_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4.2 INVOICE COUNTERS — atomic sequence per company/year
-- ------------------------------------------------------------
CREATE TABLE invoice_counters (
    company_id      INT NOT NULL ,
    `year`            INT NOT NULL,
    last_number     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, `year`),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- SECTION 5: INVOICES
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 INVOICES
-- ------------------------------------------------------------
CREATE TABLE invoices (
    id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id          INT NOT NULL ,
    invoice_number      VARCHAR(30) NOT NULL,       -- INV-2026-00001
    customer_id         INT ,
    customer_name       VARCHAR(150),               -- snapshot
    customer_phone      VARCHAR(30),
    customer_email      VARCHAR(120),
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_type       VARCHAR(10) CHECK (discount_type IN ('fixed','percent')),
    discount_value      DECIMAL(12,2) DEFAULT 0,
    discount_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    total               DECIMAL(12,2) NOT NULL DEFAULT 0,
    amount_paid         DECIMAL(12,2) NOT NULL DEFAULT 0,
    balance             DECIMAL(12,2) NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'unpaid'
                        CHECK (status IN ('draft','unpaid','partial','paid','void','cancelled')),
    issue_date          DATE NOT NULL DEFAULT (CURRENT_DATE),
    due_date            DATE,
    notes               TEXT,
    created_by          INT ,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE (company_id, invoice_number),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_date ON invoices(issue_date);

-- ------------------------------------------------------------
-- 5.2 INVOICE ITEMS
-- ------------------------------------------------------------
CREATE TABLE invoice_items (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_id      INT NOT NULL ,
    item_id         INT ,
    item_name       VARCHAR(150) NOT NULL,
    description     TEXT,
    quantity        DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
    line_total      DECIMAL(12,2) NOT NULL DEFAULT 0,
    display_order   INT NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);


-- ============================================================
-- SECTION 6: RECEIPTS
-- ============================================================

-- ------------------------------------------------------------
-- 6.1 RECEIPTS — header
-- ------------------------------------------------------------
CREATE TABLE receipts (
    id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id          INT NOT NULL ,
    receipt_type_id     INT NOT NULL ,
    template_id         INT ,
    invoice_id          INT ,   -- if payment against invoice

    receipt_number      VARCHAR(30) NOT NULL,       -- IDK-2026-00001
    verification_token  CHAR(36) NOT NULL DEFAULT (UUID()),

    -- Customer snapshot (in case customer later edited/deleted)
    customer_id         INT ,
    customer_name       VARCHAR(150),
    customer_phone      VARCHAR(30),
    customer_email      VARCHAR(120),
    customer_ref        VARCHAR(100),

    -- Financial
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_type       VARCHAR(10) CHECK (discount_type IN ('fixed','percent')),
    discount_value      DECIMAL(12,2) DEFAULT 0,
    discount_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    total               DECIMAL(12,2) NOT NULL DEFAULT 0,       -- grand total after discount
    amount_paid         DECIMAL(12,2) NOT NULL DEFAULT 0,
    balance             DECIMAL(12,2) NOT NULL DEFAULT 0,

    -- Payment
    payment_method      VARCHAR(30),                -- cash | transfer | pos | card | cheque | other
    payment_reference   VARCHAR(120),
    payment_date        DATE DEFAULT (CURRENT_DATE),
    notes               TEXT,

    -- Lifecycle
    status              VARCHAR(20) NOT NULL DEFAULT 'issued'
                        CHECK (status IN ('draft','issued','paid','partial','unpaid','void','cancelled','refunded')),
    void_reason         TEXT,
    voided_by           INT ,
    voided_at           DATETIME(6),

    -- Metadata
    created_by          INT ,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

    UNIQUE (company_id, receipt_number),
    UNIQUE (verification_token),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id),
    FOREIGN KEY (template_id) REFERENCES receipt_templates(id) ON DELETE SET NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (voided_by) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_receipts_company ON receipts(company_id);
CREATE INDEX idx_receipts_type ON receipts(receipt_type_id);
CREATE INDEX idx_receipts_customer ON receipts(customer_id);
CREATE INDEX idx_receipts_status ON receipts(status);
CREATE INDEX idx_receipts_date ON receipts(payment_date);
CREATE INDEX idx_receipts_number ON receipts(receipt_number);
CREATE INDEX idx_receipts_token ON receipts(verification_token);

-- ------------------------------------------------------------
-- 6.2 RECEIPT ITEMS — line items (max = companies.max_receipt_items)
-- ------------------------------------------------------------
CREATE TABLE receipt_items (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    receipt_id      INT NOT NULL ,
    item_id         INT ,
    item_name       VARCHAR(150) NOT NULL,
    description     TEXT,
    quantity        DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
    line_total      DECIMAL(12,2) NOT NULL DEFAULT 0,
    display_order   INT NOT NULL DEFAULT 0,
    FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_receipt_items_receipt ON receipt_items(receipt_id);

-- ------------------------------------------------------------
-- 6.3 RECEIPT FIELD VALUES — EAV for type-specific fields
--     (student_id, class, term, tenant, property, etc.)
-- ------------------------------------------------------------
CREATE TABLE receipt_field_values (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    receipt_id      INT NOT NULL ,
    field_key       VARCHAR(80) NOT NULL,
    field_value     TEXT,
    FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_rfv_receipt ON receipt_field_values(receipt_id);
CREATE INDEX idx_rfv_key ON receipt_field_values(field_key);


-- ============================================================
-- SECTION 7: PAYMENTS (for invoices — supports partial payments)
-- ============================================================

-- ------------------------------------------------------------
-- 7.1 PAYMENTS — each payment event
-- ------------------------------------------------------------
CREATE TABLE payments (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT NOT NULL ,
    invoice_id      INT ,
    receipt_id      INT ,
    amount          DECIMAL(12,2) NOT NULL,
    payment_method  VARCHAR(30),
    reference       VARCHAR(120),
    payment_date    DATE NOT NULL DEFAULT (CURRENT_DATE),
    notes           TEXT,
    recorded_by     INT ,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE SET NULL,
    FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_payments_company ON payments(company_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- ------------------------------------------------------------
-- 7.2 PAYMENT ALLOCATIONS — for future split payments
-- ------------------------------------------------------------
CREATE TABLE payment_allocations (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    payment_id      INT NOT NULL ,
    invoice_id      INT NOT NULL ,
    amount_applied  DECIMAL(12,2) NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX idx_alloc_invoice ON payment_allocations(invoice_id);


-- ============================================================
-- SECTION 8: IMPORTS (bulk CSV/XLSX)
-- ============================================================

-- ------------------------------------------------------------
-- 8.1 IMPORT JOBS — audit of every bulk import
-- ------------------------------------------------------------
CREATE TABLE import_jobs (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT NOT NULL ,
    import_type     VARCHAR(30) NOT NULL
                    CHECK (import_type IN ('items','customers','students','tenants','participants')),
    file_name       TEXT,
    total_rows      INT NOT NULL DEFAULT 0,
    success_rows    INT NOT NULL DEFAULT 0,
    failed_rows     INT NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','completed','failed','cancelled')),
    error_report    JSON,                          -- per-row errors
    created_by      INT ,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    completed_at    DATETIME(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_imports_company ON import_jobs(company_id);


-- ============================================================
-- SECTION 9: SYSTEM (SETTINGS + AUDIT)
-- ============================================================

-- ------------------------------------------------------------
-- 9.1 COMPANY SETTINGS — flexible key-value per company
-- ------------------------------------------------------------
CREATE TABLE company_settings (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT NOT NULL ,
    setting_key     VARCHAR(80) NOT NULL,
    setting_value   TEXT,
    UNIQUE (company_id, setting_key),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_company_settings_company ON company_settings(company_id);

-- ------------------------------------------------------------
-- 9.2 AUDIT LOGS — every important financial action
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      INT ,   -- NULL for super admin actions
    user_id         INT ,
    action          VARCHAR(80) NOT NULL,           -- 'receipt.created', 'plan.changed'
    entity_type     VARCHAR(50),                    -- 'receipt', 'company', 'user'
    entity_id       INT,
    old_values      JSON,
    new_values      JSON,
    reason          TEXT,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_audit_company ON audit_logs(company_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);


-- ============================================================
-- SECTION 11: SEED DATA
-- ============================================================

-- ------------------------------------------------------------
-- 11.1 PLANS
-- ------------------------------------------------------------
INSERT INTO plans (code, name, price, currency, duration_days, default_max_products, default_max_receipt_items)
VALUES
    ('monthly', 'Monthly Plan', 2000,  'NGN', 30,  50,  10),
    ('yearly',  'Yearly Plan',  10000, 'NGN', 365, 500, 20)
ON DUPLICATE KEY UPDATE code = code;

-- ------------------------------------------------------------
-- 11.2 RECEIPT TYPES (master list)
-- ------------------------------------------------------------
INSERT INTO receipt_types (code, name, description) VALUES
    ('sales',            'Sales Receipt',              'For product sales'),
    ('service',          'Service Payment Receipt',    'For services rendered'),
    ('school_fees',      'School Fees Receipt',        'For school fee payments'),
    ('training',         'Training/Course Receipt',    'For training programmes'),
    ('rent',             'Rent Receipt',               'For rent payments'),
    ('deposit',          'Deposit/Part-Payment',       'For deposits and part payments'),
    ('membership',       'Membership/Dues Receipt',    'For membership dues'),
    ('donation',         'Donation Receipt',           'For donations'),
    ('religious',        'Religious/Organisation',     'For religious organisations'),
    ('medical',          'Medical/Clinic Receipt',     'For medical services'),
    ('hotel',            'Hotel/Accommodation',        'For hotel stays'),
    ('restaurant',       'Restaurant/Food Receipt',    'For food and drinks'),
    ('event',            'Event/Hall Rental',          'For event hall rentals'),
    ('transport',        'Transport/Logistics',        'For transport services'),
    ('subscription',     'Subscription Receipt',       'For subscriptions'),
    ('invoice_payment',  'Invoice Payment Receipt',    'For invoice payments'),
    ('refund',           'Refund Receipt',             'For refunds'),
    ('general',          'General Payment Receipt',    'For general payments'),
    ('custom',           'Custom Receipt',             'For custom use cases')
ON DUPLICATE KEY UPDATE code = code;

-- ------------------------------------------------------------
-- 11.3 RECEIPT TYPE FIELDS (master field definitions)
-- ------------------------------------------------------------

-- School Fees
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, options, display_order)
SELECT id, 'student_name',     'Student Name',       'text',   TRUE,  NULL, 1 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'student_id',      'Student ID',         'text',   TRUE,  NULL, 2 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'class',           'Class',              'text',   TRUE,  NULL, 3 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'academic_session','Academic Session',   'text',   TRUE,  NULL, 4 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'fee_category',    'Fee Category',       'text',   FALSE, NULL, 5 FROM receipt_types WHERE code='school_fees';

-- Sales
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'customer_name',  'Customer Name',  'text',  TRUE,  1 FROM receipt_types WHERE code='sales'
UNION ALL SELECT id, 'customer_phone', 'Phone',        'phone', FALSE, 2 FROM receipt_types WHERE code='sales'
UNION ALL SELECT id, 'salesperson',    'Salesperson',  'text',  FALSE, 3 FROM receipt_types WHERE code='sales';

-- Rent
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'tenant_name',      'Tenant Name',       'text', TRUE,  1 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id, 'property',         'Property',          'text', TRUE,  2 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id, 'property_address', 'Property Address',  'text', FALSE, 3 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id, 'rental_period_start','Period Start',    'date', TRUE,  4 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id, 'rental_period_end', 'Period End',       'date', TRUE,  5 FROM receipt_types WHERE code='rent';

-- Training
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'participant_name', 'Participant Name', 'text', TRUE,  1 FROM receipt_types WHERE code='training'
UNION ALL SELECT id, 'programme',        'Programme',        'text', TRUE,  2 FROM receipt_types WHERE code='training'
UNION ALL SELECT id, 'cohort',           'Cohort',           'text', FALSE, 3 FROM receipt_types WHERE code='training'
UNION ALL SELECT id, 'training_period',  'Training Period',  'text', FALSE, 4 FROM receipt_types WHERE code='training';

-- Service
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'client_name',         'Client Name',        'text', TRUE, 1 FROM receipt_types WHERE code='service'
UNION ALL SELECT id, 'service_description', 'Service Description', 'textarea', FALSE, 2 FROM receipt_types WHERE code='service'
UNION ALL SELECT id, 'service_period',      'Service Period',      'text', FALSE, 3 FROM receipt_types WHERE code='service';

-- Donation
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'donor_name',   'Donor Name',   'text',     TRUE,  1 FROM receipt_types WHERE code='donation'
UNION ALL SELECT id, 'purpose',      'Purpose',      'text',     FALSE, 2 FROM receipt_types WHERE code='donation'
UNION ALL SELECT id, 'is_anonymous', 'Anonymous?',   'checkbox', FALSE, 3 FROM receipt_types WHERE code='donation';

-- Hotel
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'guest_name',  'Guest Name',  'text', TRUE, 1 FROM receipt_types WHERE code='hotel'
UNION ALL SELECT id, 'room_number', 'Room Number', 'text', TRUE, 2 FROM receipt_types WHERE code='hotel'
UNION ALL SELECT id, 'check_in',    'Check In',    'date', TRUE, 3 FROM receipt_types WHERE code='hotel'
UNION ALL SELECT id, 'check_out',   'Check Out',   'date', TRUE, 4 FROM receipt_types WHERE code='hotel';

-- Medical
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'patient_name', 'Patient Name', 'text', TRUE, 1 FROM receipt_types WHERE code='medical'
UNION ALL SELECT id, 'patient_id',   'Patient ID',   'text', TRUE, 2 FROM receipt_types WHERE code='medical'
UNION ALL SELECT id, 'department',   'Department',   'text', FALSE,3 FROM receipt_types WHERE code='medical'
UNION ALL SELECT id, 'doctor',       'Doctor',       'text', FALSE,4 FROM receipt_types WHERE code='medical';

-- Invoice Payment
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'invoice_number', 'Invoice Number', 'text', TRUE, 1 FROM receipt_types WHERE code='invoice_payment';

-- General
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'payer_name',       'Payer Name',        'text', TRUE, 1 FROM receipt_types WHERE code='general'
UNION ALL SELECT id, 'payment_purpose', 'Payment Purpose',   'text', TRUE, 2 FROM receipt_types WHERE code='general';

-- Refund
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'original_receipt_number', 'Original Receipt No.', 'text', TRUE, 1 FROM receipt_types WHERE code='refund'
UNION ALL SELECT id, 'refund_reason',         'Refund Reason',        'text', TRUE, 2 FROM receipt_types WHERE code='refund';


