-- ============================================================
-- MULTI-PURPOSE RECEIPT, INVOICE & PAYMENT MANAGEMENT SYSTEM
-- PostgreSQL Schema — Version 1.3
-- ============================================================

-- ------------------------------------------------------------
-- 0. EXTENSIONS
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()


-- ============================================================
-- SECTION 1: PLATFORM ADMINISTRATION
-- ============================================================

-- ------------------------------------------------------------
-- 1.1 PLANS — Subscription tiers managed by Super Admin
-- ------------------------------------------------------------
CREATE TABLE plans (
    id                          SERIAL PRIMARY KEY,
    code                        VARCHAR(20) UNIQUE NOT NULL,   -- 'monthly' | 'yearly'
    name                        VARCHAR(50) NOT NULL,
    price                       NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency                    VARCHAR(3) NOT NULL DEFAULT 'NGN',
    duration_days               INT NOT NULL,                  -- 30 | 365
    default_max_products        INT NOT NULL DEFAULT 50,       -- suggestion only
    default_max_receipt_items   INT NOT NULL DEFAULT 10,       -- suggestion only
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 1.2 COMPANIES — Tenant root. Everything scopes to company_id
-- ------------------------------------------------------------
CREATE TABLE companies (
    id                      SERIAL PRIMARY KEY,
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
    plan_id                 INT REFERENCES plans(id) ON DELETE SET NULL,
    plan_started_at         TIMESTAMPTZ,
    plan_expires_at         TIMESTAMPTZ,
    max_products            INT NOT NULL DEFAULT 50,           -- overrides plan default
    max_receipt_items       INT NOT NULL DEFAULT 10,           -- overrides plan default
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_companies_plan ON companies(plan_id);
CREATE INDEX idx_companies_active ON companies(is_active);

-- ------------------------------------------------------------
-- 1.3 USERS — Super Admin (company_id NULL) + company users
-- ------------------------------------------------------------
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    company_id      INT REFERENCES companies(id) ON DELETE CASCADE,   -- NULL for super_admin
    full_name       VARCHAR(120) NOT NULL,
    email           VARCHAR(120) UNIQUE NOT NULL,
    phone           VARCHAR(30),
    password_hash   TEXT NOT NULL,
    role            VARCHAR(20) NOT NULL
                    CHECK (role IN ('super_admin','owner','admin','staff')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_role ON users(role);

-- ------------------------------------------------------------
-- 1.4 SESSIONS — for connect-pg-simple
-- ------------------------------------------------------------
CREATE TABLE session (
    sid     VARCHAR NOT NULL COLLATE "default",
    sess    JSON NOT NULL,
    expire  TIMESTAMP(6) NOT NULL,
    CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX idx_session_expire ON session(expire);

-- ------------------------------------------------------------
-- 1.5 SUBSCRIPTIONS — history of plan assignments per company
-- ------------------------------------------------------------
CREATE TABLE subscriptions (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    plan_id         INT NOT NULL REFERENCES plans(id),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    assigned_by     INT REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subscriptions_company ON subscriptions(company_id);


-- ============================================================
-- SECTION 2: RECEIPT CONFIGURATION (MASTER + COMPANY-LEVEL)
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 RECEIPT TYPES — master list, platform-seeded
-- ------------------------------------------------------------
CREATE TABLE receipt_types (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(50) UNIQUE NOT NULL,   -- 'school_fees','sales','rent'
    name            VARCHAR(100) NOT NULL,         -- 'School Fees Receipt'
    description     TEXT,
    icon            VARCHAR(50),                   -- bootstrap icon class
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2.2 RECEIPT TYPE FIELDS — master field definitions per type
-- ------------------------------------------------------------
CREATE TABLE receipt_type_fields (
    id                  SERIAL PRIMARY KEY,
    receipt_type_id     INT NOT NULL REFERENCES receipt_types(id) ON DELETE CASCADE,
    field_key           VARCHAR(80) NOT NULL,      -- 'student_id'
    field_label         VARCHAR(120) NOT NULL,     -- 'Student ID'
    field_type          VARCHAR(30) NOT NULL
                        CHECK (field_type IN ('text','number','date','select','currency','checkbox','phone','email','textarea')),
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    options             JSONB,                     -- for select fields
    placeholder         VARCHAR(150),
    display_order       INT NOT NULL DEFAULT 0,
    UNIQUE (receipt_type_id, field_key)
);
CREATE INDEX idx_type_fields_type ON receipt_type_fields(receipt_type_id);

-- ------------------------------------------------------------
-- 2.3 COMPANY RECEIPT TYPES — which types each company uses
-- ------------------------------------------------------------
CREATE TABLE company_receipt_types (
    id                  SERIAL PRIMARY KEY,
    company_id          INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    receipt_type_id     INT NOT NULL REFERENCES receipt_types(id) ON DELETE CASCADE,
    is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, receipt_type_id)
);
CREATE INDEX idx_company_rt_company ON company_receipt_types(company_id);

-- ------------------------------------------------------------
-- 2.4 RECEIPT TEMPLATES — company-saved reusable templates
-- ------------------------------------------------------------
CREATE TABLE receipt_templates (
    id                  SERIAL PRIMARY KEY,
    company_id          INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    receipt_type_id     INT NOT NULL REFERENCES receipt_types(id),
    name                VARCHAR(150) NOT NULL,      -- 'JSS First Term Fees'
    description         TEXT,
    default_footer      TEXT,
    default_notes       TEXT,
    default_field_values JSONB DEFAULT '{}'::jsonb,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          INT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_templates_company ON receipt_templates(company_id);
CREATE INDEX idx_templates_type ON receipt_templates(receipt_type_id);

-- ------------------------------------------------------------
-- 2.5 RECEIPT TEMPLATE FIELDS — custom fields added per template
-- ------------------------------------------------------------
CREATE TABLE receipt_template_fields (
    id                  SERIAL PRIMARY KEY,
    template_id         INT NOT NULL REFERENCES receipt_templates(id) ON DELETE CASCADE,
    field_key           VARCHAR(80) NOT NULL,
    field_label         VARCHAR(120) NOT NULL,
    field_type          VARCHAR(30) NOT NULL,
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    options             JSONB,
    default_value       TEXT,
    display_order       INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_template_fields_template ON receipt_template_fields(template_id);

-- ------------------------------------------------------------
-- 2.6 RECEIPT TEMPLATE DEFAULT ITEMS — pre-fill items on new receipt
-- ------------------------------------------------------------
CREATE TABLE receipt_template_items (
    id              SERIAL PRIMARY KEY,
    template_id     INT NOT NULL REFERENCES receipt_templates(id) ON DELETE CASCADE,
    item_id         INT,                        -- references items(id), FK added later
    item_name       VARCHAR(150) NOT NULL,
    description     TEXT,
    quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
    display_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_template_items_template ON receipt_template_items(template_id);


-- ============================================================
-- SECTION 3: BUSINESS DATA (CATALOG + CUSTOMERS)
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 CATEGORIES — for grouping items
-- ------------------------------------------------------------
CREATE TABLE categories (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, name)
);
CREATE INDEX idx_categories_company ON categories(company_id);

-- ------------------------------------------------------------
-- 3.2 ITEMS — products/services catalog (max = companies.max_products)
-- ------------------------------------------------------------
CREATE TABLE items (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id     INT REFERENCES categories(id) ON DELETE SET NULL,
    name            VARCHAR(150) NOT NULL,
    description     TEXT,
    default_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
    sku             VARCHAR(50),
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_items_company ON items(company_id);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_name_search ON items USING gin (to_tsvector('english', name));

-- Now add FK from receipt_template_items → items
ALTER TABLE receipt_template_items
    ADD CONSTRAINT fk_template_items_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3.3 CUSTOMERS — reusable payer records (customers/students/tenants)
-- ------------------------------------------------------------
CREATE TABLE customers (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_type   VARCHAR(30) NOT NULL DEFAULT 'customer'
                    CHECK (customer_type IN ('customer','student','tenant','participant','subscriber','patient','member','donor','guest')),
    external_ref    VARCHAR(100),                -- student ID, tenant code, etc.
    full_name       VARCHAR(150) NOT NULL,
    phone           VARCHAR(30),
    email           VARCHAR(120),
    address         TEXT,
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customers_company ON customers(company_id);
CREATE INDEX idx_customers_type ON customers(customer_type);
CREATE INDEX idx_customers_ref ON customers(company_id, external_ref);
CREATE INDEX idx_customers_name_search ON customers USING gin (to_tsvector('english', full_name));

-- ------------------------------------------------------------
-- 3.4 CUSTOMER PROFILES — EAV for type-specific attributes
--     (student: class, term, session; tenant: property, unit)
-- ------------------------------------------------------------
CREATE TABLE customer_profiles (
    id              SERIAL PRIMARY KEY,
    customer_id     INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    profile_key     VARCHAR(80) NOT NULL,       -- 'class','term','property','unit'
    profile_value   TEXT
);
CREATE INDEX idx_customer_profiles_customer ON customer_profiles(customer_id);
CREATE INDEX idx_customer_profiles_key ON customer_profiles(profile_key);


-- ============================================================
-- SECTION 4: RECEIPT COUNTERS (for ABBR-YYYY-NNNNN numbering)
-- ============================================================

-- ------------------------------------------------------------
-- 4.1 RECEIPT COUNTERS — atomic sequence per company/year/type
-- ------------------------------------------------------------
CREATE TABLE receipt_counters (
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year            INT NOT NULL,
    receipt_type_id INT NOT NULL REFERENCES receipt_types(id) ON DELETE CASCADE,
    last_number     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, year, receipt_type_id)
);

-- ------------------------------------------------------------
-- 4.2 INVOICE COUNTERS — atomic sequence per company/year
-- ------------------------------------------------------------
CREATE TABLE invoice_counters (
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year            INT NOT NULL,
    last_number     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, year)
);


-- ============================================================
-- SECTION 5: INVOICES
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 INVOICES
-- ------------------------------------------------------------
CREATE TABLE invoices (
    id                  SERIAL PRIMARY KEY,
    company_id          INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    invoice_number      VARCHAR(30) NOT NULL,       -- INV-2026-00001
    customer_id         INT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name       VARCHAR(150),               -- snapshot
    customer_phone      VARCHAR(30),
    customer_email      VARCHAR(120),
    subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_type       VARCHAR(10) CHECK (discount_type IN ('fixed','percent')),
    discount_value      NUMERIC(12,2) DEFAULT 0,
    discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    total               NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_paid         NUMERIC(12,2) NOT NULL DEFAULT 0,
    balance             NUMERIC(12,2) NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'unpaid'
                        CHECK (status IN ('draft','unpaid','partial','paid','void','cancelled')),
    issue_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date            DATE,
    notes               TEXT,
    created_by          INT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, invoice_number)
);
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_date ON invoices(issue_date);

-- ------------------------------------------------------------
-- 5.2 INVOICE ITEMS
-- ------------------------------------------------------------
CREATE TABLE invoice_items (
    id              SERIAL PRIMARY KEY,
    invoice_id      INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    item_id         INT REFERENCES items(id) ON DELETE SET NULL,
    item_name       VARCHAR(150) NOT NULL,
    description     TEXT,
    quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    display_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);


-- ============================================================
-- SECTION 6: RECEIPTS
-- ============================================================

-- ------------------------------------------------------------
-- 6.1 RECEIPTS — header
-- ------------------------------------------------------------
CREATE TABLE receipts (
    id                  SERIAL PRIMARY KEY,
    company_id          INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    receipt_type_id     INT NOT NULL REFERENCES receipt_types(id),
    template_id         INT REFERENCES receipt_templates(id) ON DELETE SET NULL,
    invoice_id          INT REFERENCES invoices(id) ON DELETE SET NULL,   -- if payment against invoice

    receipt_number      VARCHAR(30) NOT NULL,       -- IDK-2026-00001
    verification_token  UUID NOT NULL DEFAULT gen_random_uuid(),

    -- Customer snapshot (in case customer later edited/deleted)
    customer_id         INT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name       VARCHAR(150),
    customer_phone      VARCHAR(30),
    customer_email      VARCHAR(120),
    customer_ref        VARCHAR(100),

    -- Financial
    subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_type       VARCHAR(10) CHECK (discount_type IN ('fixed','percent')),
    discount_value      NUMERIC(12,2) DEFAULT 0,
    discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    total               NUMERIC(12,2) NOT NULL DEFAULT 0,       -- grand total after discount
    amount_paid         NUMERIC(12,2) NOT NULL DEFAULT 0,
    balance             NUMERIC(12,2) NOT NULL DEFAULT 0,

    -- Payment
    payment_method      VARCHAR(30),                -- cash | transfer | pos | card | cheque | other
    payment_reference   VARCHAR(120),
    payment_date        DATE DEFAULT CURRENT_DATE,
    notes               TEXT,

    -- Lifecycle
    status              VARCHAR(20) NOT NULL DEFAULT 'issued'
                        CHECK (status IN ('draft','issued','paid','partial','unpaid','void','cancelled','refunded')),
    void_reason         TEXT,
    voided_by           INT REFERENCES users(id),
    voided_at           TIMESTAMPTZ,

    -- Metadata
    created_by          INT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (company_id, receipt_number),
    UNIQUE (verification_token)
);
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
    id              SERIAL PRIMARY KEY,
    receipt_id      INT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    item_id         INT REFERENCES items(id) ON DELETE SET NULL,
    item_name       VARCHAR(150) NOT NULL,
    description     TEXT,
    quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    display_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_receipt_items_receipt ON receipt_items(receipt_id);

-- ------------------------------------------------------------
-- 6.3 RECEIPT FIELD VALUES — EAV for type-specific fields
--     (student_id, class, term, tenant, property, etc.)
-- ------------------------------------------------------------
CREATE TABLE receipt_field_values (
    id              SERIAL PRIMARY KEY,
    receipt_id      INT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    field_key       VARCHAR(80) NOT NULL,
    field_value     TEXT
);
CREATE INDEX idx_rfv_receipt ON receipt_field_values(receipt_id);
CREATE INDEX idx_rfv_key ON receipt_field_values(field_key);


-- ============================================================
-- SECTION 7: PAYMENTS (for invoices — supports partial payments)
-- ============================================================

-- ------------------------------------------------------------
-- 7.1 PAYMENTS — each payment event
-- ------------------------------------------------------------
CREATE TABLE payments (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    invoice_id      INT REFERENCES invoices(id) ON DELETE SET NULL,
    receipt_id      INT REFERENCES receipts(id) ON DELETE SET NULL,
    amount          NUMERIC(12,2) NOT NULL,
    payment_method  VARCHAR(30),
    reference       VARCHAR(120),
    payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    notes           TEXT,
    recorded_by     INT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_company ON payments(company_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- ------------------------------------------------------------
-- 7.2 PAYMENT ALLOCATIONS — for future split payments
-- ------------------------------------------------------------
CREATE TABLE payment_allocations (
    id              SERIAL PRIMARY KEY,
    payment_id      INT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id      INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount_applied  NUMERIC(12,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX idx_alloc_invoice ON payment_allocations(invoice_id);


-- ============================================================
-- SECTION 8: IMPORTS (bulk CSV/XLSX)
-- ============================================================

-- ------------------------------------------------------------
-- 8.1 IMPORT JOBS — audit of every bulk import
-- ------------------------------------------------------------
CREATE TABLE import_jobs (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    import_type     VARCHAR(30) NOT NULL
                    CHECK (import_type IN ('items','customers','students','tenants','participants')),
    file_name       TEXT,
    total_rows      INT NOT NULL DEFAULT 0,
    success_rows    INT NOT NULL DEFAULT 0,
    failed_rows     INT NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','completed','failed','cancelled')),
    error_report    JSONB,                          -- per-row errors
    created_by      INT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_imports_company ON import_jobs(company_id);


-- ============================================================
-- SECTION 9: SYSTEM (SETTINGS + AUDIT)
-- ============================================================

-- ------------------------------------------------------------
-- 9.1 COMPANY SETTINGS — flexible key-value per company
-- ------------------------------------------------------------
CREATE TABLE company_settings (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    setting_key     VARCHAR(80) NOT NULL,
    setting_value   TEXT,
    UNIQUE (company_id, setting_key)
);
CREATE INDEX idx_company_settings_company ON company_settings(company_id);

-- ------------------------------------------------------------
-- 9.2 AUDIT LOGS — every important financial action
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
    id              SERIAL PRIMARY KEY,
    company_id      INT REFERENCES companies(id) ON DELETE SET NULL,   -- NULL for super admin actions
    user_id         INT REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(80) NOT NULL,           -- 'receipt.created', 'plan.changed'
    entity_type     VARCHAR(50),                    -- 'receipt', 'company', 'user'
    entity_id       INT,
    old_values      JSONB,
    new_values      JSONB,
    reason          TEXT,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_company ON audit_logs(company_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);


-- ============================================================
-- SECTION 10: TRIGGERS — auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_items_updated
    BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_customers_updated
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_templates_updated
    BEFORE UPDATE ON receipt_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_receipts_updated
    BEFORE UPDATE ON receipts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_invoices_updated
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


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
ON CONFLICT (code) DO NOTHING;

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
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------
-- 11.3 RECEIPT TYPE FIELDS (master field definitions)
-- ------------------------------------------------------------

-- School Fees
INSERT INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, options, display_order)
SELECT id, 'student_name',     'Student Name',       'text',   TRUE,  NULL::jsonb, 1 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'student_id',      'Student ID',         'text',   TRUE,  NULL::jsonb, 2 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'class',           'Class',              'text',   TRUE,  NULL::jsonb, 3 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'term',            'Term',               'select', TRUE,  '["First Term", "Second Term", "Third Term"]'::jsonb, 4 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'academic_session','Academic Session',   'text',   TRUE,  NULL::jsonb, 5 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id, 'fee_category',    'Fee Category',       'text',   FALSE, NULL::jsonb, 6 FROM receipt_types WHERE code='school_fees';

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

-- ------------------------------------------------------------
-- 11.4 SUPER ADMIN SEED
--      Replace __REPLACE_WITH_BCRYPT_HASH__ before running!
-- ------------------------------------------------------------
INSERT INTO users (company_id, full_name, email, password_hash, role, is_active)
VALUES (
    NULL,
    