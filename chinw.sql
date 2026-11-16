-- Multi-purpose receipt, invoice and payment management system
-- MySQL 8.0.16+ / InnoDB / utf8mb4
--
-- This script is safe to run more than once: it creates only missing tables
-- and ignores already-seeded reference records. It does not alter tables that
-- already exist; use a separate migration for schema changes.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS plans (
  id INT NOT NULL AUTO_INCREMENT, code VARCHAR(20) NOT NULL, name VARCHAR(50) NOT NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0, currency CHAR(3) NOT NULL DEFAULT 'NGN',
  duration_days INT NOT NULL, default_max_products INT NOT NULL DEFAULT 50,
  default_max_receipt_items INT NOT NULL DEFAULT 10, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS companies (
  id INT NOT NULL AUTO_INCREMENT, name VARCHAR(150) NOT NULL, abbreviation VARCHAR(10),
  logo_path TEXT, use_logo_watermark BOOLEAN NOT NULL DEFAULT FALSE, address TEXT, phone VARCHAR(30),
  email VARCHAR(120), website VARCHAR(150), tin VARCHAR(50), cac_number VARCHAR(50),
  default_currency CHAR(3) NOT NULL DEFAULT 'NGN', receipt_footer TEXT,
  header_position VARCHAR(10) NOT NULL DEFAULT 'left', plan_id INT NULL,
  plan_started_at DATETIME(6), plan_expires_at DATETIME(6), max_products INT NOT NULL DEFAULT 50,
  max_receipt_items INT NOT NULL DEFAULT 10, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_companies_abbreviation (abbreviation), KEY idx_companies_plan (plan_id),
  KEY idx_companies_active (is_active), CONSTRAINT chk_companies_header CHECK (header_position IN ('left','center','right')),
  CONSTRAINT fk_companies_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NULL, full_name VARCHAR(120) NOT NULL,
  email VARCHAR(120) NOT NULL, phone VARCHAR(30), password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, last_login_at DATETIME(6),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_users_email (email), KEY idx_users_company (company_id), KEY idx_users_role (role),
  CONSTRAINT chk_users_role CHECK (role IN ('super_admin','owner','admin','staff')),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session` (
  sid VARCHAR(255) NOT NULL, sess JSON NOT NULL, expire DATETIME(6) NOT NULL,
  PRIMARY KEY (sid), KEY idx_session_expire (expire)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, plan_id INT NOT NULL, assigned_by INT NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), expires_at DATETIME(6) NOT NULL,
  notes TEXT, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), KEY idx_subscriptions_company (company_id),
  CONSTRAINT fk_subscriptions_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_subscriptions_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_types (
  id INT NOT NULL AUTO_INCREMENT, code VARCHAR(50) NOT NULL, name VARCHAR(100) NOT NULL, description TEXT,
  icon VARCHAR(50), is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (id), UNIQUE KEY uq_receipt_types_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_type_fields (
  id INT NOT NULL AUTO_INCREMENT, receipt_type_id INT NOT NULL, field_key VARCHAR(80) NOT NULL,
  field_label VARCHAR(120) NOT NULL, field_type VARCHAR(30) NOT NULL, is_required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSON NULL, placeholder VARCHAR(150), display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id), UNIQUE KEY uq_type_fields_key (receipt_type_id, field_key), KEY idx_type_fields_type (receipt_type_id),
  CONSTRAINT chk_type_fields_type CHECK (field_type IN ('text','number','date','select','currency','checkbox','phone','email','textarea')),
  CONSTRAINT fk_type_fields_type FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_receipt_types (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, receipt_type_id INT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_company_receipt_types (company_id, receipt_type_id), KEY idx_company_rt_company (company_id),
  CONSTRAINT fk_company_rt_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_rt_type FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_templates (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, receipt_type_id INT NOT NULL, name VARCHAR(150) NOT NULL,
  description TEXT, default_footer TEXT, default_notes TEXT, default_field_values JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), KEY idx_templates_company (company_id), KEY idx_templates_type (receipt_type_id),
  CONSTRAINT fk_templates_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_templates_type FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id),
  CONSTRAINT fk_templates_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_template_fields (
  id INT NOT NULL AUTO_INCREMENT, template_id INT NOT NULL, field_key VARCHAR(80) NOT NULL,
  field_label VARCHAR(120) NOT NULL, field_type VARCHAR(30) NOT NULL, is_required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSON NULL, default_value TEXT, display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id), KEY idx_template_fields_template (template_id),
  CONSTRAINT fk_template_fields_template FOREIGN KEY (template_id) REFERENCES receipt_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, name VARCHAR(100) NOT NULL, description TEXT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (id),
  UNIQUE KEY uq_categories_company_name (company_id, name), KEY idx_categories_company (company_id),
  CONSTRAINT fk_categories_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS items (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, category_id INT NULL, name VARCHAR(150) NOT NULL,
  description TEXT, default_price DECIMAL(12,2) NOT NULL DEFAULT 0, default_quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
  sku VARCHAR(50), status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), KEY idx_items_company (company_id), KEY idx_items_status (status), FULLTEXT KEY idx_items_name_search (name),
  CONSTRAINT chk_items_status CHECK (status IN ('active','inactive')),
  CONSTRAINT chk_items_default_quantity CHECK (default_quantity > 0),
  CONSTRAINT fk_items_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_template_items (
  id INT NOT NULL AUTO_INCREMENT, template_id INT NOT NULL, item_id INT NULL, item_name VARCHAR(150) NOT NULL,
  description TEXT, quantity DECIMAL(10,2) NOT NULL DEFAULT 1, unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0, PRIMARY KEY (id), KEY idx_template_items_template (template_id),
  CONSTRAINT fk_template_items_template FOREIGN KEY (template_id) REFERENCES receipt_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_template_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, customer_type VARCHAR(30) NOT NULL DEFAULT 'customer',
  external_ref VARCHAR(100), full_name VARCHAR(150) NOT NULL, phone VARCHAR(30), email VARCHAR(120), address TEXT,
  notes TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), KEY idx_customers_company (company_id), KEY idx_customers_type (customer_type),
  KEY idx_customers_ref (company_id, external_ref), FULLTEXT KEY idx_customers_name_search (full_name),
  CONSTRAINT chk_customers_type CHECK (customer_type IN ('customer','student','tenant','participant','subscriber','patient','member','donor','guest')),
  CONSTRAINT fk_customers_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_profiles (
  id INT NOT NULL AUTO_INCREMENT, customer_id INT NOT NULL, profile_key VARCHAR(80) NOT NULL, profile_value TEXT,
  PRIMARY KEY (id), UNIQUE KEY uq_customer_profiles_key (customer_id, profile_key),
  KEY idx_customer_profiles_customer (customer_id), KEY idx_customer_profiles_key (profile_key),
  CONSTRAINT fk_customer_profiles_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_counters (
  company_id INT NOT NULL, `year` INT NOT NULL, receipt_type_id INT NOT NULL, last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, `year`, receipt_type_id),
  CONSTRAINT fk_receipt_counters_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipt_counters_type FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_counters (
  company_id INT NOT NULL, `year` INT NOT NULL, last_number INT NOT NULL DEFAULT 0, PRIMARY KEY (company_id, `year`),
  CONSTRAINT fk_invoice_counters_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, invoice_number VARCHAR(30) NOT NULL, customer_id INT NULL,
  customer_name VARCHAR(150), customer_phone VARCHAR(30), customer_email VARCHAR(120),
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0, discount_type VARCHAR(10) NULL, discount_value DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0, total DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0, balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'unpaid', issue_date DATE NOT NULL DEFAULT (CURRENT_DATE), due_date DATE NULL,
  notes TEXT, created_by INT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_invoices_number (company_id, invoice_number), KEY idx_invoices_company (company_id),
  KEY idx_invoices_customer (customer_id), KEY idx_invoices_status (status), KEY idx_invoices_date (issue_date),
  CONSTRAINT chk_invoices_discount CHECK (discount_type IS NULL OR discount_type IN ('fixed','percent')),
  CONSTRAINT chk_invoices_status CHECK (status IN ('draft','unpaid','partial','paid','void','cancelled')),
  CONSTRAINT fk_invoices_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT NOT NULL AUTO_INCREMENT, invoice_id INT NOT NULL, item_id INT NULL, item_name VARCHAR(150) NOT NULL,
  description TEXT, quantity DECIMAL(10,2) NOT NULL DEFAULT 1, unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0, PRIMARY KEY (id),
  KEY idx_invoice_items_invoice (invoice_id),
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_invoice_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipts (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, receipt_type_id INT NOT NULL, template_id INT NULL, invoice_id INT NULL,
  receipt_number VARCHAR(30) NOT NULL, verification_token CHAR(36) NOT NULL,
  customer_id INT NULL, customer_name VARCHAR(150), customer_phone VARCHAR(30), customer_email VARCHAR(120), customer_ref VARCHAR(100),
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0, discount_type VARCHAR(10) NULL, discount_value DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0, total DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0, balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(30), payment_reference VARCHAR(120), payment_date DATE DEFAULT (CURRENT_DATE), notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'issued', void_reason TEXT, voided_by INT NULL, voided_at DATETIME(6), created_by INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_receipts_number (company_id, receipt_number), UNIQUE KEY uq_receipts_token (verification_token),
  KEY idx_receipts_company (company_id), KEY idx_receipts_type (receipt_type_id), KEY idx_receipts_customer (customer_id),
  KEY idx_receipts_status (status), KEY idx_receipts_date (payment_date),
  CONSTRAINT chk_receipts_discount CHECK (discount_type IS NULL OR discount_type IN ('fixed','percent')),
  CONSTRAINT chk_receipts_status CHECK (status IN ('draft','issued','paid','partial','unpaid','void','cancelled','refunded')),
  CONSTRAINT fk_receipts_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipts_type FOREIGN KEY (receipt_type_id) REFERENCES receipt_types(id),
  CONSTRAINT fk_receipts_template FOREIGN KEY (template_id) REFERENCES receipt_templates(id) ON DELETE SET NULL,
  CONSTRAINT fk_receipts_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  CONSTRAINT fk_receipts_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_receipts_voided_by FOREIGN KEY (voided_by) REFERENCES users(id),
  CONSTRAINT fk_receipts_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_items (
  id INT NOT NULL AUTO_INCREMENT, receipt_id INT NOT NULL, item_id INT NULL, item_name VARCHAR(150) NOT NULL,
  description TEXT, quantity DECIMAL(10,2) NOT NULL DEFAULT 1, unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0, PRIMARY KEY (id),
  KEY idx_receipt_items_receipt (receipt_id),
  CONSTRAINT fk_receipt_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipt_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_field_values (
  id INT NOT NULL AUTO_INCREMENT, receipt_id INT NOT NULL, field_key VARCHAR(80) NOT NULL, field_value TEXT,
  PRIMARY KEY (id), KEY idx_rfv_receipt (receipt_id), KEY idx_rfv_key (field_key),
  CONSTRAINT fk_rfv_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, invoice_id INT NULL, receipt_id INT NULL,
  amount DECIMAL(12,2) NOT NULL, payment_method VARCHAR(30), reference VARCHAR(120),
  payment_date DATE NOT NULL DEFAULT (CURRENT_DATE), notes TEXT, recorded_by INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (id),
  KEY idx_payments_company (company_id), KEY idx_payments_invoice (invoice_id),
  CONSTRAINT fk_payments_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INT NOT NULL AUTO_INCREMENT, payment_id INT NOT NULL, invoice_id INT NOT NULL, amount_applied DECIMAL(12,2) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (id),
  KEY idx_alloc_payment (payment_id), KEY idx_alloc_invoice (invoice_id),
  CONSTRAINT fk_alloc_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_alloc_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_jobs (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, import_type VARCHAR(30) NOT NULL, file_name TEXT,
  total_rows INT NOT NULL DEFAULT 0, success_rows INT NOT NULL DEFAULT 0, failed_rows INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', error_report JSON NULL, created_by INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), completed_at DATETIME(6), PRIMARY KEY (id),
  KEY idx_imports_company (company_id),
  CONSTRAINT chk_import_type CHECK (import_type IN ('items','customers','students','tenants','participants')),
  CONSTRAINT chk_import_status CHECK (status IN ('pending','completed','failed','cancelled')),
  CONSTRAINT fk_imports_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_imports_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_settings (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NOT NULL, setting_key VARCHAR(80) NOT NULL, setting_value TEXT,
  PRIMARY KEY (id), UNIQUE KEY uq_company_settings (company_id, setting_key), KEY idx_company_settings_company (company_id),
  CONSTRAINT fk_company_settings_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT NOT NULL AUTO_INCREMENT, company_id INT NULL, user_id INT NULL, action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50), entity_id INT, old_values JSON NULL, new_values JSON NULL, reason TEXT,
  ip_address VARCHAR(45), user_agent TEXT, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), KEY idx_audit_company (company_id), KEY idx_audit_user (user_id), KEY idx_audit_action (action),
  KEY idx_audit_entity (entity_type, entity_id), KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed/reference data. INSERT IGNORE preserves existing values.
INSERT IGNORE INTO plans (code, name, price, currency, duration_days, default_max_products, default_max_receipt_items) VALUES
  ('monthly','Monthly Plan',2000,'NGN',30,50,10),
  ('yearly','Yearly Plan',10000,'NGN',365,500,20);

INSERT IGNORE INTO receipt_types (code, name, description) VALUES
  ('sales','Sales Receipt','For product sales'), ('service','Service Payment Receipt','For services rendered'),
  ('school_fees','School Fees Receipt','For school fee payments'), ('training','Training/Course Receipt','For training programmes'),
  ('rent','Rent Receipt','For rent payments'), ('deposit','Deposit/Part-Payment','For deposits and part payments'),
  ('membership','Membership/Dues Receipt','For membership dues'), ('donation','Donation Receipt','For donations'),
  ('religious','Religious/Organisation','For religious organisations'), ('medical','Medical/Clinic Receipt','For medical services'),
  ('hotel','Hotel/Accommodation','For hotel stays'), ('restaurant','Restaurant/Food Receipt','For food and drinks'),
  ('event','Event/Hall Rental','For event hall rentals'), ('transport','Transport/Logistics','For transport services'),
  ('subscription','Subscription Receipt','For subscriptions'), ('invoice_payment','Invoice Payment Receipt','For invoice payments'),
  ('refund','Refund Receipt','For refunds'), ('general','General Payment Receipt','For general payments'), ('custom','Custom Receipt','For custom use cases');

INSERT IGNORE INTO receipt_type_fields (receipt_type_id, field_key, field_label, field_type, is_required, display_order)
SELECT id, 'student_name','Student Name','text',TRUE,1 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id,'student_id','Student ID','text',TRUE,2 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id,'class','Class','text',TRUE,3 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id,'academic_session','Academic Session','text',TRUE,4 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id,'fee_category','Fee Category','text',FALSE,5 FROM receipt_types WHERE code='school_fees'
UNION ALL SELECT id,'customer_name','Customer Name','text',TRUE,1 FROM receipt_types WHERE code='sales'
UNION ALL SELECT id,'customer_phone','Phone','phone',FALSE,2 FROM receipt_types WHERE code='sales'
UNION ALL SELECT id,'salesperson','Salesperson','text',FALSE,3 FROM receipt_types WHERE code='sales'
UNION ALL SELECT id,'tenant_name','Tenant Name','text',TRUE,1 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id,'property','Property','text',TRUE,2 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id,'property_address','Property Address','text',FALSE,3 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id,'rental_period_start','Period Start','date',TRUE,4 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id,'rental_period_end','Period End','date',TRUE,5 FROM receipt_types WHERE code='rent'
UNION ALL SELECT id,'participant_name','Participant Name','text',TRUE,1 FROM receipt_types WHERE code='training'
UNION ALL SELECT id,'programme','Programme','text',TRUE,2 FROM receipt_types WHERE code='training'
UNION ALL SELECT id,'cohort','Cohort','text',FALSE,3 FROM receipt_types WHERE code='training'
UNION ALL SELECT id,'training_period','Training Period','text',FALSE,4 FROM receipt_types WHERE code='training'
UNION ALL SELECT id,'client_name','Client Name','text',TRUE,1 FROM receipt_types WHERE code='service'
UNION ALL SELECT id,'service_description','Service Description','textarea',FALSE,2 FROM receipt_types WHERE code='service'
UNION ALL SELECT id,'service_period','Service Period','text',FALSE,3 FROM receipt_types WHERE code='service'
UNION ALL SELECT id,'donor_name','Donor Name','text',TRUE,1 FROM receipt_types WHERE code='donation'
UNION ALL SELECT id,'purpose','Purpose','text',FALSE,2 FROM receipt_types WHERE code='donation'
UNION ALL SELECT id,'is_anonymous','Anonymous?','checkbox',FALSE,3 FROM receipt_types WHERE code='donation'
UNION ALL SELECT id,'guest_name','Guest Name','text',TRUE,1 FROM receipt_types WHERE code='hotel'
UNION ALL SELECT id,'room_number','Room Number','text',TRUE,2 FROM receipt_types WHERE code='hotel'
UNION ALL SELECT id,'check_in','Check In','date',TRUE,3 FROM receipt_types WHERE code='hotel'
UNION ALL SELECT id,'check_out','Check Out','date',TRUE,4 FROM receipt_types WHERE code='hotel'
UNION ALL SELECT id,'patient_name','Patient Name','text',TRUE,1 FROM receipt_types WHERE code='medical'
UNION ALL SELECT id,'patient_id','Patient ID','text',TRUE,2 FROM receipt_types WHERE code='medical'
UNION ALL SELECT id,'department','Department','text',FALSE,3 FROM receipt_types WHERE code='medical'
UNION ALL SELECT id,'doctor','Doctor','text',FALSE,4 FROM receipt_types WHERE code='medical'
UNION ALL SELECT id,'invoice_number','Invoice Number','text',TRUE,1 FROM receipt_types WHERE code='invoice_payment'
UNION ALL SELECT id,'payer_name','Payer Name','text',TRUE,1 FROM receipt_types WHERE code='general'
UNION ALL SELECT id,'payment_purpose','Payment Purpose','text',TRUE,2 FROM receipt_types WHERE code='general'
UNION ALL SELECT id,'original_receipt_number','Original Receipt No.','text',TRUE,1 FROM receipt_types WHERE code='refund'
UNION ALL SELECT id,'refund_reason','Refund Reason','text',TRUE,2 FROM receipt_types WHERE code='refund';

-- Create the first super-admin through the application after generating a bcrypt hash.
