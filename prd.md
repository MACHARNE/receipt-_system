# PRODUCT REQUIREMENTS DOCUMENT (PRD)

## Multi-Purpose Receipt, Invoice & Payment Management System

**Version:** 3.6 — Complete Consolidated Edition
**Status:** Approved Baseline — Source of Truth for Development, Teaching, and Deployment
**Document Owner:** Product & Engineering
**Audience:** Product team, engineering team, students, QA, stakeholders

---

## DOCUMENT CONTROL

| Version | Date        | Change Summary                                                                                                                                                     |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | Initial     | Product concept                                                                                                                                                    |
| 1.1     | Superseded  | Super Admin, plans, per-company limits                                                                                                                             |
| 1.2     | Superseded  | Per-company limits, EAV, role-aware dashboards                                                                                                                     |
| 1.3     | Superseded  | Bulk import                                                                                                                                                        |
| 2.0     | Superseded  | Consolidated with built codebase                                                                                                                                   |
| 3.0     | Superseded  | Complete PRD with theory, architecture, procedures, phases, glossary                                                                                               |
| 3.1     | Superseded  | Company identity made platform-managed; receipt number format corrected; build status added (§52.1)                                                                |
| **3.5** | Superseded  | People module with CSV import, receipt prefill and write-back, repeat-a-receipt, item default quantity, rebuilt settings page (§17, §18, §19, §20, §33, §46)       |
| **3.6** | **Current** | **Collection reports with CSV export (§30), company team management (§13.4, §46), role-aware dashboards (§7), staff restricted from reports and the address book** |

---

## TABLE OF CONTENTS

**Part A — Product Definition**

1. Product Overview
2. Product Objectives
3. Target Market
4. Product Principles
5. Success Criteria
6. Product Statement

**Part B — Functional Requirements** 7. User Roles 8. Company Provisioning 9. Authentication & Sessions 10. Subscription Plans 11. Company Setup 12. Receipt Types (Master) 13. Dynamic Fields per Type 14. Custom Fields per Company 15. Templates 16. Receipt Appearance & Colors 17. Item / Service Library 18. Customers 19. Bulk Import 20. Receipt Issuance 21. Line Items 22. Discounts 23. Payment & Status 24. Receipt Numbering 25. Invoices 26. QR Verification 27. Receipt Lifecycle 28. PDF Generation 29. Printing 30. Retrieval & Search 31. Reports 32. Audit Trail 33. Smart Defaults & Quick Receipts 34. Role-Aware Dashboards

**Part C — Non-Functional Requirements** 35. Security 36. Data Isolation 37. Performance 38. Responsive Design 39. Accessibility 40. Error Handling

**Part D — Technical Architecture** 41. Technology Stack 42. Database Design 43. Backend Design 44. Frontend Design 45. File Structure 46. API Reference

**Part E — Procedures** 47. Environment Setup 48. Development Workflow 49. Testing Discipline 50. Deployment Checklist 51. Backup & Recovery

**Part F — Build Phases** 52. Phase Breakdown

**Part G — Scope** 53. Version 1 Scope 54. Future Scope 55. Out of Scope

**Part H — Appendices** 56. Glossary 57. Teaching Notes 58. Acceptance Criteria

---

# PART A — PRODUCT DEFINITION

## 1. PRODUCT OVERVIEW

The **Multi-Purpose Receipt, Invoice & Payment Management System** is a multi-tenant, SaaS-style web application that enables companies to create, customise, issue, retrieve, verify, and report on receipts and invoices for any business use case.

The product is built on two principles:

> **Configure once. Issue receipts quickly.**

> **Complex business logic stays behind a simple user interface.**

Rather than building one application per industry, the platform provides a **common receipt engine** that adapts to different use cases through **Receipt Types** and **Receipt Templates**.

Every issued receipt carries:

- A unique receipt number: `ABBR-YYYY-NNNNN`
- A QR verification token (UUID)
- A PDF rendering with company branding

The platform is operated by a **Super Admin** who provisions companies, assigns subscription plans, and sets per-company limits. **Companies do not self-register.**

---

## 2. PRODUCT OBJECTIVES

1. Make receipt generation simple, fast, and reliable.
2. Support unlimited receipt use cases.
3. Let companies customise receipts without programming.
4. Let companies save reusable templates.
5. Maintain accurate, retrievable financial records.
6. Support invoices and partial payments.
7. Generate professional PDFs and clean print layouts.
8. Provide QR-code verification for every issued receipt.
9. Allow retrieval of past receipts using many filters.
10. Provide financial and collection reports.
11. Support company branding (logo, colors, footer, header position).
12. Support multiple users per company with role-based access.
13. Maintain an audit trail for all sensitive actions.
14. Enforce **all plan limits and identity checks server-side**.
15. Operate as a multi-tenant SaaS platform from day one.

---

## 3. TARGET MARKET

- Retail shops and supermarkets
- Schools and training centres
- ICT companies and consultants
- Professional service providers
- Property managers and landlords
- Churches, NGOs, associations
- Hotels, restaurants, event centres
- Clinics
- Logistics businesses
- Subscription businesses
- General SMEs

No industry-specific setup is required.

---

## 4. PRODUCT PRINCIPLES

1. **Simple** — an ordinary staff member can issue a receipt with minimal training.
2. **Configurable** — organisations adapt without code changes.
3. **Reusable** — templates, items, and defaults eliminate retyping.
4. **Traceable** — every important action has a user and timestamp.
5. **Verifiable** — receipts are independently verifiable via QR.
6. **Secure** — tenant isolation and plan limits enforced server-side.
7. **Scalable** — new types, fields, and tenants can be added without rebuilding.

---

## 5. SUCCESS CRITERIA

Version 1 is successful when:

1. A Super Admin can log in and provision a company.
2. The Super Admin can assign a plan and set per-company limits.
3. The Super Admin can create the Owner account.
4. The Owner can log in with those credentials.
5. The Owner can configure company name, abbreviation, logo.
6. The Owner can enable receipt types.
7. The Owner can add custom fields per type.
8. The Owner can set a color per receipt type; text remains readable.
9. The Owner can create templates with default values and items.
10. The company can store items up to `max_products`.
11. CSV import works and respects limits.
12. Customers can be created; CSV import works.
13. Users can issue a receipt with dynamic fields, up to `max_receipt_items` items, discount, and payment.
14. The server generates `ABBR-YYYY-NNNNN` and a UUID token.
15. Payment status is auto-computed.
16. Receipts can be viewed, printed, and downloaded as PDF.
17. QR verification works, including VOID status.
18. Receipts can be retrieved by multiple filters.
19. Reports show collection totals and breakdowns.
20. Plan limits are enforced server-side.
21. Company A cannot access Company B's data.
22. Company users cannot change their own plan.
23. Every sensitive action is logged.
24. The UI is responsive and mobile-friendly.

---

## 6. PRODUCT STATEMENT

> A simple, configurable, multi-tenant, multi-purpose receipt, invoice, and payment management platform that lets businesses and organisations issue professional, verifiable receipts for any purpose — with per-type branding, reusable templates, secure payments, retrievable records, and PDFs — all under a centrally managed subscription model enforced server-side.

---

# PART B — FUNCTIONAL REQUIREMENTS

## 7. USER ROLES

Two levels: **Platform** and **Company**.

### 7.1 Super Admin (Platform)

Operates the platform. `company_id = NULL`.

**Can:**

- Create, edit, enable, disable companies
- Assign subscription plans
- Set plan start/expiry dates
- Set per-company limits (`max_products`, `max_receipt_items`)
- Create the first company user (Owner)
- Reset owner passwords
- View all companies and subscription status
- Manage plans
- View platform-level audit logs
- Access a separate Super Admin portal

**Cannot:**

- Issue receipts
- Access a company's operational data

### 7.2 Owner (Company)

Full control of the company account.

**Can:**

- Read company information, logo and receipt appearance (§11 — read-only)
- Create/manage Admins and Staff
- Enable/disable receipt types
- Add custom fields per type
- Set per-type colors
- Create/edit/delete templates
- Manage items (up to `max_products`)
- Create receipts and invoices
- View reports
- Void receipts
- View audit logs

**Cannot:**

- Change their own plan or limits
- Change the company's own identity, logo, footer, watermark, header position or currency
  (platform-managed — see §11)
- Access other companies' data

### 7.3 Administrator (Company)

Operational role.

**Can:**

- Manage customers
- Manage items
- Create receipts and invoices
- Retrieve receipts and generate PDFs
- View reports
- Manage templates where permitted

**Cannot:**

- Manage company users
- Change plan or limits
- Void receipts (unless permitted)
- Access settings

### 7.4 Staff / Cashier (Company)

Minimal interface.

**Can:**

- Create receipts
- Search customers
- Retrieve receipts
- Print receipts
- Download PDFs

**Cannot:**

- View reports
- Access settings
- Edit items or templates
- Void receipts

---

## 8. COMPANY PROVISIONING

Companies are **not self-registered**. The flow:

```
Super Admin logs into Super Admin portal
        ↓
Creates company (name, abbreviation, contact)
        ↓
Assigns plan; sets per-company limits
        ↓
Creates Owner account (name, email) — system generates the password
        ↓
Hands generated credentials to company Owner
        ↓
Owner logs into Company portal
        ↓
Owner completes company setup (logo, colors, etc.)
        ↓
Owner enables receipt types, adds custom fields
        ↓
Owner adds items/services (or imports CSV)
        ↓
Owner creates templates
        ↓
Owner adds Admins and Staff
        ↓
Staff issue receipts
```

**Rules:**

- There is **no public sign-up**. Companies exist only by the flow above; the platform
  deliberately exposes no registration endpoint.
- Abbreviation must be unique across the platform (2–10 alphanumeric uppercase).
- Abbreviation is required — receipt numbers depend on it.
- Owner email must be unique.
- **Passwords are generated by the system.** The Super Admin leaves the password field
  blank and the server generates a strong random password, returning it once for handover.
  Supplying a manual password is allowed but must be at least 8 characters.
- Plan code must exist and be active.
- Per-company limits default from the plan but can be overridden by Super Admin.
- Every action is audited.

---

## 9. AUTHENTICATION & SESSIONS

**Two login portals:**

- Company Portal — Owner, Admin, Staff
- Super Admin Portal — Super Admin only

**Requirements:**

- Login, logout, session persistence
- Session store: PostgreSQL via `connect-pg-simple`
- Cookie: `httpOnly`, `sameSite=lax`, signed, `secure` in production
- bcrypt password hashing (cost 10)
- Password policy: system-generated passwords are 14 characters with one character from
  each of four groups (lower, upper, digit, symbol) and exclude look-alike characters
  (`0 O 1 l I`) so they can be transcribed by hand. A manually supplied password must be
  at least 8 characters and at most 72 bytes (bcrypt's limit).
- Generated passwords are returned once in the response body, never stored in plaintext,
  never written to the audit trail and never logged. The Super Admin is told to pass them
  to the owner, who should change them after first sign-in.
- Session carries `userId`, `companyId`, `role`, `fullName`
- Login updates `last_login_at`
- Login rejects if:
  - Email/password invalid → 401
  - Account disabled → 403
  - Company disabled → 403
  - Plan expired → 402
- Role-based route guards: `requireLogin`, `requireSuperAdmin`, `requireCompanyUser`, `requireRole`

---

## 10. SUBSCRIPTION PLANS

Managed by Super Admin. Assigned to companies.

**Fields per plan:**

- `code` (unique)
- `name`
- `price`, `currency`
- `duration_days`
- `default_max_products`
- `default_max_receipt_items`
- `is_active`

**Seeded plans:**

| Code      | Name         | Price   | Duration | Default Max Products | Default Max Items |
| --------- | ------------ | ------- | -------- | -------------------- | ----------------- |
| `monthly` | Monthly Plan | ₦2,000  | 30 days  | 50                   | 10                |
| `yearly`  | Yearly Plan  | ₦10,000 | 365 days | 500                  | 20                |

**Rules:**

- Only Super Admin can assign/change plans.
- Plan values are defaults. **Authoritative limits live on `companies`.**
- Company users cannot view, select, or change plan/limits.
- All limits enforced server-side.
- Expiry behavior: soft lock (read-only) recommended; hard lock optional.

**Subscription history:** Every plan assignment is recorded in `subscriptions`.

---

## 11. COMPANY SETUP

Owner performs setup:

**Step 1 — Company Information (managed by the Platform Administrator)**

Company identity is **not** self-service. The Super Admin owns these fields and the company
can only read them (§7.2, §46). This keeps every issued receipt consistent and prevents
company details being changed by accident.

Super Admin sets:

- Company name
- Abbreviation (2–10 alphanumeric uppercase) — used in receipt numbers
- Logo (PNG/JPG/WEBP, ≤ 2 MB)
- Address, Phone, Email, Website
- TIN (optional)
- CAC number (optional)
- Default currency (NGN default)
- Receipt footer message
- Header position (`left` / `center` / `right`)
- Use logo as watermark (yes/no)

All of these are editable at any time from **Super Admin → Companies → Details**. Changing
the abbreviation affects receipt numbers issued _after_ the change; already-issued receipts
keep the number they were given.

**Step 2 — Receipt Types**
Enable the types the company uses.

**Step 3 — Appearance per Type**
Choose a base color per type. The system computes contrast-safe text color.

**Step 4 — Items**
Add up to `max_products` items.

**Step 5 — Users**
Add Admins and Staff.

---

## 12. RECEIPT TYPES (MASTER)

Master list seeded at installation:

1. Sales Receipt
2. Service Payment Receipt
3. School Fees Receipt
4. Training/Course Receipt
5. Rent Receipt
6. Deposit/Part-Payment Receipt
7. Membership/Dues Receipt
8. Donation Receipt
9. Religious/Organisation Payment Receipt
10. Medical/Clinic Receipt
11. Hotel/Accommodation Receipt
12. Restaurant/Food Receipt
13. Event/Hall Rental Receipt
14. Transport/Logistics Receipt
15. Subscription Receipt
16. Invoice Payment Receipt
17. Refund Receipt
18. General Payment Receipt
19. Custom Receipt

Companies enable only what they need. Enabled status is per-company (`company_receipt_types`).

---

## 13. DYNAMIC FIELDS PER TYPE

Each receipt type has its own master field set. Rendered dynamically when that type is chosen.

**Master fields (seeded for common types):**

| Type            | Fields                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| School Fees     | student_name, student_id, class, academic_session, fee_category                 |
| Sales           | customer_name, customer_phone, salesperson                                      |
| Rent            | tenant_name, property, property_address, rental_period_start, rental_period_end |
| Training        | participant_name, programme, cohort, training_period                            |
| Service         | client_name, service_description, service_period                                |
| Donation        | donor_name, purpose, is_anonymous                                               |
| Hotel           | guest_name, room_number, check_in, check_out                                    |
| Medical         | patient_name, patient_id, department, doctor                                    |
| Invoice Payment | invoice_number                                                                  |
| General Payment | payer_name, payment_purpose                                                     |
| Refund          | original_receipt_number, refund_reason                                          |

**Field types supported:**
`text`, `textarea`, `number`, `currency`, `date`, `select`, `checkbox`, `phone`, `email`.

**Storage:** `receipt_field_values (receipt_id, field_key, field_value)` — EAV pattern.

**Financial section is common across all types.**

---

## 14. CUSTOM FIELDS PER COMPANY

Custom fields belong to a **receipt type** for a **company**. They appear on every receipt of that type.

**Example:**

- Field: Hostel Block
- Type: Dropdown
- Options: A, B, C, D
- Required: Yes

**Stored in:** `company_receipt_type_fields`.

**Rules:**

- `field_key` auto-generated from label (lowercase, underscores).
- Cannot collide with master field keys.
- Can be edited or deleted by Owner/Admin.
- Appear on the receipt form merged after master fields.
- Appear on templates for default-value setting.

---

## 15. TEMPLATES

A template is a company's reusable configuration for a receipt type.

**Fields:**

- Name, description
- Receipt type
- Default field values (`default_field_values` JSONB map)
- Default items (name, quantity, unit price, order)
- Default footer, default notes
- Active/inactive

**Example:**

- Type: School Fees Receipt
- Template: **JSS1 First Term 2026/2027**
- Default values: `{ "term": "First", "academic_session": "2026/2027" }`
- Default items: Tuition Fee ×1 @ 50000, ICT Fee ×1 @ 5000

**Usage:**

- Selected during receipt creation.
- Fields, items, and notes pre-fill automatically.
- Can be edited or deleted.
- Template list shows usage count.

**Stored in:** `receipt_templates`, `receipt_template_items`.

---

## 16. RECEIPT APPEARANCE & COLORS

Each **receipt type per company** can have a **base color**.

**Stored in:** `company_receipt_type_themes`.

**Auto-computed fields:**

- `header_text_color` — WCAG-safe text color (white or near-black)
- `accent_color` — soft tint for totals boxes

**Luminance computation:**

```javascript
function luminance(rgb) {
  const srgb = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}
function pickTextColor(rgb) {
  return luminance(rgb) > 0.55 ? "#111827" : "#ffffff";
}
```

**Results:**

- Yellow `#ffff00` → dark text
- Navy `#1e3a8a` → white text

**Retain prompt:** When issuing again for the same type, the UI prompts:

> "Use the same color as last time?"

User can accept or override. Override becomes new default for that type.

**Body text never changes** — always readable near-black.

---

## 17. ITEM / SERVICE LIBRARY

Each company stores up to `companies.max_products` items.

**Fields:**

- Name
- Description
- Default price
- Default quantity (optional, default 1)
- SKU (optional, unique per company)
- Category (optional)
- Status: `active` / `inactive`

> **Default quantity** is the quantity the item is normally sold in — 1 for a fee, 100 for a
> pack of 100. Selecting it from the catalog fills that number into the receipt line, which the
> user can still change. It is deliberately **not stock control**: nothing is decremented or
> reserved, and §54 still lists real inventory as future scope. It can be set on the item form
> or supplied as a `default_quantity` column on import.

**Server enforces limit on:**

- Create
- Update (no effect if only updating an existing item)
- CSV import (rejects if projected count > limit)

**Examples:** Tuition Fee, ICT Fee, Registration Fee, Training Fee, Result PIN, Consultation, Hall Rental, Laptop, Printing, Website Maintenance.

**Categories:** optional, in `categories` table.

---

## 18. CUSTOMERS

Reusable customer / payer records.

**Fields:**

- Name
- Phone
- Email
- Address
- Customer reference
- Customer type: `customer`, `student`, `tenant`, `participant`, `subscriber`, `patient`, `member`, `donor`, `guest`
- Notes
- Active flag

**Type-specific attributes** stored in `customer_profiles` (EAV).

**Auto-creation:** When a receipt is issued with a new name/phone, the customer is auto-created.

**Duplicate matching:** By phone number if provided.

**Search:** Available during receipt creation (autocomplete from name).

### 18.1 Implementation

`routes/customers.js`, `customers.html`, `js/customers.js`.

- The importer understands `full_name`, `type`, `external_ref`, `phone`, `email`, `address`
  and `notes`. **Any other column becomes a remembered attribute** — a column called `class`
  is stored against each person and filled in on their next receipt. One import format
  therefore works for schools, landlords, clinics and memberships alike.
- `external_ref` is unique per company, so an admission number cannot be duplicated.
- **Prefill.** Typing a name on the receipt form searches these records; choosing one fills in
  the reference, class and contact details, mapping them onto whichever detail fields the
  receipt type actually uses (`student_name`, `patient_name`, `tenant_code`, …). Everything
  stays editable.
- **Write-back.** When a receipt is issued for a saved person, the details that describe the
  _person_ rather than the transaction are copied back onto their record — so correcting a
  class on a receipt means the next receipt for that student is already right. The receipt
  keeps its own snapshot and is never rewritten. See `utils/customerSync.js`; changes are
  audited as `customer.updated_from_receipt`.
- A receipt can never _delete_ information: attributes it says nothing about are left alone.
- Which fields count as belonging to the person is defined in one place
  (`NAME_KEYS`, `REFERENCE_KEYS`, `REMEMBERED_ATTRIBUTES` in `utils/customerSync.js`) and is
  deliberately not "every field on the receipt" — the fee category and the amount are
  properties of the transaction, not of the person.
- There is no plan limit on people. Plans cap items and receipt lines only.

---

## 19. BULK IMPORT

CSV import for:

1. Products / Items
2. Customers
3. Students
4. Tenants
5. Participants

> **Implementation note:** the items and people importers are built
> (`/items/import/*`, `/customers/import/*`). Students, tenants and participants do not need
> importers of their own — they are the same `customers` table distinguished by `type`, so one
> people import covers all of them and a school can upload a class list with `type,student`
> in a single column.

**Workflow:**

1. Download a per-type CSV template.
2. Fill in Excel / Google Sheets.
3. Upload the file.
4. Server validates every row.
5. Preview shows total, valid, error counts and per-row errors with line numbers.
6. User downloads the error report if needed.
7. User confirms; valid rows are inserted in a single transaction.
8. Import logged in `import_jobs` and audit trail.

**Rules:**

- File size ≤ 5 MB
- Max 5,000 rows
- Header row must match template exactly
- Plan limits checked **before** insert
- Duplicate SKU / email / student ID rejected with clear messages
- Partial imports never leave the DB in an inconsistent state (transaction)

---

## 20. RECEIPT ISSUANCE

**Workflow:**

**Step 1 — New Receipt**
Choose a receipt type or a template.

**Step 2 — Customer**
Search existing or type new (auto-created).

**Step 3 — Details**
Dynamic fields load for the type.

**Step 4 — Items**
From catalog or custom; capped by `max_receipt_items`.

**Step 5 — Financials**
Server computes: subtotal, discount, total.

**Step 6 — Payment**
Method, amount, reference, date → server computes balance and status.

**Step 7 — Save**
Server:

- Validates
- Checks limits
- Begins transaction
- Generates `ABBR-YYYY-NNNNN`
- Generates UUID token
- Inserts receipt, items, field values
- Updates per-type theme if changed
- Writes audit log
- Commits

**Step 8 — Completion**
Redirect to view with actions: View, Print, Download PDF, New Receipt.

### 20.1 Repeating a receipt

Issuing the same kind of receipt for a different person is the most common repeat task — a
term's fees for the next student, this month's bill for the next tenant. Rather than filling
everything in again:

1. Open an already-issued receipt and choose **Create another like this**.
2. `GET /receipts/:id/basis` returns the type, line items, discount, payment method and the
   transaction's detail values (the session, the fee category).
3. The form opens pre-filled with those, and with the _person's_ details deliberately cleared.
4. The user types the new name; the saved record fills in their reference and class.

Everything copied in remains editable. The result is a **new receipt with its own number** —
the original is never altered, so §27 still holds: receipts are never edited. The basis
endpoint drops the name, reference and remembered person attributes so a copy can never be
mis-issued to the wrong person by default.

---

## 21. LINE ITEMS

Each receipt supports up to `companies.max_receipt_items` line items.

**Fields per line:**

- Item / service name
- Description
- Quantity (positive number)
- Unit price (≥ 0)
- Line total (auto)

**Server computations:**

```
line_total = quantity × unit_price
subtotal   = sum(line_total)
```

**Storage:** `receipt_items` (with `display_order`).

**Enforcement:** Server rejects if `items.length > max_receipt_items`.

---

## 22. DISCOUNTS

Optional. Supported:

- None
- Fixed amount
- Percentage (0–100)

**Server computation:**

```
if fixed:   discount_amount = min(discount_value, subtotal)
if percent: discount_amount = subtotal × (discount_value / 100)
total = subtotal - discount_amount
```

**Capped** so discount never exceeds subtotal.

---

## 23. PAYMENT & STATUS

**Payment fields:**

- Amount paid
- Payment method: Cash, Bank Transfer, POS, Card, Cheque, Other
- Payment reference (optional)
- Payment date
- Notes (optional)

**Server computes:**

- Balance = total − amount_paid (never negative)
- Status:
  - `paid` — amount_paid ≥ total
  - `partial` — 0 < amount_paid < total
  - `unpaid` — amount_paid = 0

**Rejects:**

- Negative amount_paid
- amount_paid > total

**Future scope:** split payments — schema (`payments`, `payment_allocations`) already anticipates.

---

## 24. RECEIPT NUMBERING

**Format:** `ABBR-TYPECODE-YYYY-NNNNN`

Example: `IDK-SCHOOLFE-2026-00001`

**Segments:**

- `ABBR` — from `companies.abbreviation` (required; set by the Super Admin)
- `TYPECODE` — short code of the receipt type, uppercased, alphanumeric, max 8 characters
- `YYYY` — year of issuance
- `NNNNN` — per-type counter, zero-padded

**Rules:**

- Abbreviation from `companies.abbreviation`
- Year = year of issuance
- Sequence resets every Jan 1
- Per company, per year, **per receipt type** — the type code keeps the segments unambiguous
- Never reused
- Generated atomically inside transaction

> **Implementation note:** `utils/receiptNumber.js` falls back to `RCPT` when a company has no
> abbreviation. Since every company is now created with an abbreviation by the Super Admin,
> that fallback exists only as a guard against direct database edits.

**Implementation:**

```sql
INSERT INTO receipt_counters (company_id, year, receipt_type_id, last_number)
VALUES ($1, $2, $3, 1)
ON CONFLICT (company_id, year, receipt_type_id)
DO UPDATE SET last_number = receipt_counters.last_number + 1
RETURNING last_number;
```

This is a single atomic statement. Concurrent requests get distinct numbers.

---

## 25. INVOICES

**Separate concept from receipts.**

- **Invoice** = amount expected
- **Payment** = money received
- **Receipt** = evidence of payment

**One invoice can receive multiple payments.**

**Numbering:** `INV-YYYY-NNNNN` via `invoice_counters`.

**Status:** `draft`, `unpaid`, `partial`, `paid`, `void`, `cancelled`.

**Storage:** `invoices`, `invoice_items`.

---

## 26. QR VERIFICATION

Every receipt has a QR code pointing to:

```
/verify/{verification_token}
```

**Token:** UUID generated server-side via `gen_random_uuid()`.

**Public verification page displays:**

```
RECEIPT VERIFIED
Company:        {name}
Receipt Number: {ABBR-YYYY-NNNNN}
Date:           {date}
Amount Paid:    {amount}
Status:         PAID
```

**Never exposes:**

- Customer full contact
- Line-item detail
- Internal IDs
- Notes, subtotal, discount or any internal record id
- The verification token itself

**Implementation:**

- `utils/verifyUrl.js` builds the absolute link. It prefers `PUBLIC_BASE_URL` and falls back to
  the request's host, so the code works unchanged on localhost and in production.
- `utils/qr.js` holds the QR options, so the code on screen and the code printed in the PDF are
  identical and scannable at the same physical size.
- `GET /verify/:token` serves the page and `GET /verify/:token/data` serves the result.
  Responses are sent with `Cache-Control: no-store` — a verification result must never be
  cached by a proxy or browser.
- An unknown or malformed token returns 404 and the page shows **Not Verified**.

**Void handling:** Voided receipts show:

```
RECEIPT FOUND
Status: VOID
This receipt is no longer valid.
```

---

## 27. RECEIPT LIFECYCLE

```
Draft → Issued → Paid / Partial → Void / Refunded where applicable
```

**To correct:**

1. User requests void.
2. Authorised user confirms.
3. Original receipt remains stored.
4. Status changes to VOID.
5. Reason recorded.
6. Corrected transaction may be created.

**Receipts are never physically deleted.**

---

## 28. PDF GENERATION

Server-generated PDF per receipt.

**Contents:**

- Company logo
- Company name, address, contact
- TIN / CAC (optional)
- Receipt title, number, date
- Customer / payer info
- Dynamic receipt fields
- Item table
- Subtotal, discount, total
- Amount paid, balance
- Payment method, reference
- Staff / issuer
- **QR verification code**
- Footer
- Optional signature area
- Optional watermark

**Theme-aware:** honors per-type color with contrast-safe text, using `utils/theme.js` — the
same module the front end mirrors, so the PDF and the screen cannot disagree about contrast.

**Delivery:** Direct download to user's device (`Content-Disposition: attachment`, filename is
the receipt number). Served with `Cache-Control: no-store`.

**Library:** PDFKit (`backend/utils/pdf.js`).

**Implementation notes:**

- The document is built into a buffer and sent once complete, so a failure part-way through
  returns a clean error instead of a truncated download.
- Amounts are formatted exactly as on screen (grouped, two decimals, no symbol) and the
  currency is stated once above the totals as `Amounts in {CODE}`. PDFKit's built-in fonts
  cannot render symbols such as NGN's, and embedding a font for one glyph is not worth the
  file size.
- PDFKit embeds PNG and JPEG only, while logo uploads also accept WebP. A logo it cannot embed
  is skipped rather than failing the receipt.
- A voided receipt carries a red **VOIDED — THIS RECEIPT IS NO LONGER VALID** banner with the
  reason, who voided it and when.
- Long receipts paginate: extra pages repeat the item table header.

---

## 29. PRINTING

- `print.css` hides navbar, buttons, chrome
- Uses `@page` margins
- `print-color-adjust: exact` preserves colors
- Clean A4 / Letter layout

---

## 30. RETRIEVAL & SEARCH

**Filters:**

- Receipt number
- Customer / payer
- Date / date range
- Receipt type
- Template
- Payment status
- Payment method
- Amount range
- Staff who created it

**Actions:** View, Print, Download PDF, Void (permission-gated).

**Pagination:** 25 per page default, up to 100.

---

## 31. REPORTS

**Basic reports:**

- Today's collections
- Daily / weekly / monthly collections
- Custom date range
- Receipts by type
- Payments by method
- Outstanding balances
- Receipts by staff
- Invoice status
- Discounts granted

**Example output:**

```
September 2026
Total Invoiced:   ₦3,850,000
Total Collected:  ₦3,240,000
Outstanding:      ₦610,000
Discounts:        ₦85,000
Receipts:         126
```

**Export:** PDF (core), CSV, Excel (later).

---

## 32. AUDIT TRAIL

**Logged actions:**

- Receipt created, voided
- Invoice created, payment recorded
- Item created, updated, deleted, imported
- Template created, updated, deleted
- Receipt type enabled, disabled
- Custom field added, updated, deleted
- Receipt type theme updated
- User created, disabled, password reset
- Company settings changed
- Plan assigned, changed, status toggled, limits changed

**Each entry:**

- Company ID
- User ID
- Action (string)
- Entity type + ID
- Old / new values (JSONB)
- Reason (where required)
- IP address
- User agent
- Timestamp

**Storage:** `audit_logs`.

---

## 33. SMART DEFAULTS & QUICK RECEIPTS

**Remembered values:**

- Currency
- Payment method
- Academic session
- Default template per type
- Company information
- Receipt footer
- Per-type color

**Quick Receipts:** Dashboard shows commonly used templates; clicking opens the form pre-filled.

---

## 34. ROLE-AWARE DASHBOARDS

**Owner Dashboard:** Dashboard, Receipts, Invoices, Customers, Items, Templates, Types, Users, Reports, Audit, Settings

**Administrator Dashboard:** Dashboard, Receipts, Invoices, Customers, Items, Templates, Reports

**Staff Dashboard:** Dashboard, New Receipt, My Receipts, Customer Search

**Super Admin Dashboard:** Companies, Plans, Audit, Settings

**Summary cards adapt per role.**

---

# PART C — NON-FUNCTIONAL REQUIREMENTS

## 35. SECURITY

**Non-negotiable rules:**

1. Client is never trusted. All critical decisions recomputed server-side.
2. Session is the identity. `companyId` from `req.session`, never from payload.
3. Database is the authority for plan limits and permissions.
4. No endpoint allows a company user to change their own plan or limits.
5. No cross-company data access. Every query scoped by `company_id`.
6. All SQL uses parameterised queries.
7. Receipt numbers and verification tokens generated server-side.
8. Session cookies: `httpOnly`, signed, `sameSite=lax`, `secure` in production.
9. bcrypt password hashing (cost 10). Passwords are generated server-side via
   `crypto.randomInt` (CSPRNG, no modulo bias); plaintext passwords are never stored,
   logged, or written to the audit trail.
10. Rate limiting on auth and public verify endpoints. Implemented in
    `middleware/rateLimit.js` — see §35.1.
11. File uploads validated (type, size), stored outside web root or served with strict headers.
12. Audit logging for all financial actions.

**Additional:**

- HTTPS in production
- Environment variables via `.env`
- No secrets in code
- CSRF: `sameSite=lax` cookie plus JSON-only mutation endpoints

### 35.1 Rate Limiting

Implemented in `middleware/rateLimit.js`, with no external dependency.

| Scope       | Endpoint                  | Limit                 | Key              | Counts             |
| ----------- | ------------------------- | --------------------- | ---------------- | ------------------ |
| Per network | `POST /auth/login`        | 50 requests / 15 min  | `req.ip`         | every request      |
| Per account | `POST /auth/login`        | 10 failures / 15 min  | `req.ip` + email | only 401, 402, 403 |
| Per network | `GET /verify/:token/data` | 100 requests / 10 min | `req.ip`         | every request      |

**Design decisions:**

- Only **failed** sign-ins count towards the account limit, so a legitimate user who signs in
  and out repeatedly is never locked out.
- The account limit is keyed by IP **and** email, so one person's failed attempts cannot lock
  out colleagues sharing an office or school network.
- Exceeding a limit returns `429` with a plain-language message and a `Retry-After` header. The
  sign-in page displays that message directly.
- `GET /verify/:token` (the page) is not limited: it serves a static file and reads no data.

**Known limitations, accepted for Version 1:**

- State is per process and held in memory. A restart clears the counters, and a horizontally
  scaled deployment would need a shared store such as Redis.
- The window is fixed rather than sliding, so a burst straddling a boundary can briefly reach
  twice the limit. That is harmless for brute-force protection.
- Behind a reverse proxy every client appears as the proxy's address unless
  `TRUST_PROXY=true` is set (§47). It is off by default: trusting `X-Forwarded-For` with no
  proxy in front would let a client spoof its own address and sidestep the limits.

---

## 36. DATA ISOLATION

Every business table has `company_id`.

**Enforced:**

- On insert: `company_id` = session value
- On select/update/delete: `WHERE company_id = $sessionCompanyId`
- On joins: both sides scoped
- On receipt numbers: per company
- On audit: scoped

**Proven by:** Attempting to access another company's receipt by ID returns 404.

---

## 37. PERFORMANCE

**Targets:**

- Receipt form loads < 1s on a warm cache
- Receipt search < 200ms for 10,000 receipts
- PDF generation < 3s
- Customer autocomplete < 300ms

**Indexes:**

- `company_id` on all tenant tables
- `receipt_number`, `invoice_number`
- `customer_id`
- `receipt_date`
- `status`
- `verification_token`
- `email` on `users`

**Connection pooling** via `pg` Pool (max 10).

---

## 38. RESPONSIVE DESIGN

- Bootstrap 5 grid
- Mobile-first
- Tables inside `.table-responsive`
- Modals usable one-handed
- Touch targets ≥ 44px
- Tested on: desktop, laptop, tablet, phone

---

## 39. ACCESSIBILITY

- WCAG-safe color contrast for receipt themes
- Semantic HTML
- Labels on all inputs
- Focus indicators
- Screen-reader-friendly alerts
- Keyboard-navigable forms

---

## 40. ERROR HANDLING

**User-facing messages in plain language.**

Never show:

- "Database constraint violation"
- Stack traces
- SQL text

Always show:

- "This email is already registered."
- "Your plan allows only 50 items."
- "This receipt could not be saved. Please check the information and try again."

**Log technical detail server-side.**

**HTTP status codes:**

| Code | Meaning           | When                      |
| ---- | ----------------- | ------------------------- |
| 200  | OK                | Successful GET/PUT/DELETE |
| 201  | Created           | Successful POST           |
| 400  | Bad Request       | Missing/invalid input     |
| 401  | Unauthorized      | Not logged in             |
| 402  | Payment Required  | Plan expired              |
| 403  | Forbidden         | Role/limit failure        |
| 404  | Not Found         | Resource missing          |
| 409  | Conflict          | Duplicate                 |
| 429  | Too Many Requests | Rate limit exceeded       |
| 500  | Server Error      | Unexpected                |

**PostgreSQL error codes handled:**

- `23505` → 409 (unique violation)
- `23503` → 400 (foreign key violation)
- `23514` → 400 (check violation)

---

# PART D — TECHNICAL ARCHITECTURE

## 41. TECHNOLOGY STACK

**Frontend:**

- HTML5
- CSS3
- Bootstrap 5 (CDN)
- Bootstrap Icons
- Vanilla JavaScript (no framework — deliberate)

**Backend:**

- Node.js (LTS)
- Express.js

**Database:**

- PostgreSQL
- `pg` client

**Sessions:**

- `express-session`
- `connect-pg-simple`

**Auth:**

- `bcrypt` / `bcryptjs`

**Uploads:**

- `multer`

**CSV:**

- `csv-parse`

**QR:**

- `qrcode`

**PDF:**

- `pdfkit`

**Environment:**

- `dotenv`

**Development:**

- `nodemon`

**Deliberate omissions:**

- No frontend framework
- No ORM
- No build step

This keeps the fundamentals visible.

---

## 42. DATABASE DESIGN

### 42.1 Entity Groups

**Platform administration:**

- `plans`
- `subscriptions`
- `session`

**Identity:**

- `users`
- `companies`

**Receipt configuration:**

- `receipt_types`
- `receipt_type_fields`
- `company_receipt_types`
- `company_receipt_type_fields`
- `company_receipt_type_themes`
- `receipt_templates`
- `receipt_template_items`

**Counters:**

- `receipt_counters`
- `invoice_counters`

**Business data:**

- `categories`
- `items`
- `customers`
- `customer_profiles`

**Invoices:**

- `invoices`
- `invoice_items`

**Payments:**

- `payments`
- `payment_allocations`

**Receipts:**

- `receipts`
- `receipt_items`
- `receipt_field_values`

**Imports:**

- `import_jobs`

**System:**

- `company_settings`
- `audit_logs`

### 42.2 Key Design Patterns

**Foreign keys** with appropriate `ON DELETE`:

- `CASCADE` when child is meaningless without parent
- `SET NULL` when child survives parent deletion

**Unique constraints:**

- `users.email`
- `companies.abbreviation`
- `(company_id, receipt_number)`
- `(company_id, invoice_number)`
- `receipts.verification_token`
- `(company_id, receipt_type_id, field_key)` on custom fields

**Check constraints:**

- `role IN ('super_admin','owner','admin','staff')`
- `status IN (...)`
- `field_type IN (...)`
- `header_position IN ('left','center','right')`

**Indexes** on all foreign keys and search columns.

**EAV pattern** for:

- `receipt_field_values`
- `customer_profiles`
- `company_receipt_type_fields`

**Trigger** `set_updated_at` on tables with `updated_at`.

### 42.3 Transactions

Used for:

- Company + Owner creation
- Receipt creation (with items and field values)
- Template creation/update
- CSV import commit

Every transaction: `BEGIN`, operations, `COMMIT`, or `ROLLBACK` on error.

### 42.4 Row-Level Locks

Used implicitly via `UPSERT ... RETURNING` on counters. Guarantees no duplicate receipt numbers under concurrency.

---

## 43. BACKEND DESIGN

### 43.1 File Organization

```
backend/
├── server.js              ← Express app
├── db.js                  ← Pool
├── schema.sql             ← Database
├── .env                   ← Secrets
├── mikeadmin.js           ← DB health check
├── middleware/
│   ├── auth.js
│   ├── upload.js
│   └── uploadImport.js
├── routes/
│   ├── auth.js
│   ├── superadmin.js
│   ├── company.js
│   ├── categories.js
│   ├── items.js
│   ├── customers.js       ← people: students, tenants, patients, members
│   ├── receiptConfig.js
│   ├── receipts.js
│   ├── verify.js          ← public QR verification (no session guard)
│   ├── reports.js
│   └── users.js
└── utils/
    ├── theme.js
    ├── receiptNumber.js
    ├── password.js
    ├── customerSync.js    ← keeps saved people in step with issued receipts
    ├── receiptData.js     ← shared loader for the JSON and PDF renderers
    ├── verifyUrl.js       ← absolute /verify/<token> link
    ├── qr.js              ← QR options shared by screen and PDF
    └── pdf.js
```

### 43.2 Middleware Order

```
1. cors()
2. express.json()
3. express.urlencoded()
4. session()
5. express.static()
6. route mounts
7. 404 handler
8. error handler
```

Order is functional, not decorative.

### 43.3 Route Pattern

Every mutating route:

```
1. Extract and validate input
2. Check plan limits
3. Verify authorization
4. Begin transaction
5. Insert / update
6. Write audit log
7. Commit
8. Respond with proper status
```

### 43.4 SQL Parameterisation

Always `$1, $2` placeholders. Never string concatenation. Prevents SQL injection.

---

## 44. FRONTEND DESIGN

### 44.1 File Organization

```
frontend/
├── index.html
├── dashboard.html
├── settings.html
├── items.html
├── customers.html
├── receipt-types.html
├── templates.html
├── receipts.html
├── receipt-new.html
├── receipt-view.html
├── reports.html
├── users.html
├── superadmin-dashboard.html
├── verify.html
├── css/
│   ├── app.css
│   └── print.css
└── js/
    ├── api.js
    └── <per-page>.js
```

### 44.2 `api.js` Helper

Centralised fetch with:

- `credentials: "include"`
- JSON parsing
- Consistent error shape
- `.get()`, `.post()`, `.put()`, `.del()`

### 44.3 State Pattern

Module-level `state` object per page. Render functions read from state. Event handlers mutate state then re-render.

### 44.4 HTML Safety

`escapeHtml()` used on every dynamic value inserted via `innerHTML`.

### 44.5 Responsive Rules

- Bootstrap grid
- `.table-responsive` around tables
- Modals sized with `modal-lg` on desktop, full-width on mobile
- Touch-friendly buttons

---

## 45. FILE STRUCTURE

```
receipt_system/
├── backend/
│   ├── node_modules/
│   ├── package.json
│   ├── .env
│   ├── .env.example
│   ├── server.js
│   ├── db.js
│   ├── schema.sql
│   ├── mikeadmin.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── upload.js
│   │   └── uploadImport.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── superadmin.js
│   │   ├── company.js
│   │   ├── categories.js
│   │   ├── items.js
│   │   ├── customers.js
│   │   ├── receiptConfig.js
│   │   ├── receipts.js
│   │   ├── verify.js
│   │   ├── reports.js
│   │   └── users.js
│   ├── utils/
│   │   ├── theme.js
│   │   ├── receiptNumber.js
│   │   ├── password.js
│   │   ├── customerSync.js
│   │   ├── receiptData.js
│   │   ├── verifyUrl.js
│   │   ├── qr.js
│   │   └── pdf.js
│   └── uploads/
│       ├── logos/
│       └── imports/
│
└── frontend/
    ├── index.html
    ├── dashboard.html
    ├── settings.html
    ├── items.html
    ├── customers.html
    ├── receipt-types.html
    ├── templates.html
    ├── receipts.html
    ├── receipt-new.html
    ├── receipt-view.html
    ├── reports.html
    ├── users.html
    ├── superadmin-dashboard.html
    ├── verify.html
    ├── css/
    │   ├── app.css
    │   └── print.css
    └── js/
        ├── api.js
        ├── auth.js
        ├── settings.js
        ├── items.js
        ├── customers.js
        ├── receipt-types.js
        ├── templates.js
        ├── receipts.js
        ├── receipt-new.js
        ├── receipt-view.js
        ├── reports.js
        ├── users.js
        ├── superadmin.js
        └── verify.js
```

---

## 46. API REFERENCE

### Auth

| Method | Route          | Purpose         |
| ------ | -------------- | --------------- |
| POST   | `/auth/login`  | Sign in         |
| POST   | `/auth/logout` | Sign out        |
| GET    | `/auth/me`     | Current session |

### Super Admin

| Method | Route                                            | Purpose                    |
| ------ | ------------------------------------------------ | -------------------------- |
| GET    | `/superadmin/plans`                              | List plans                 |
| GET    | `/superadmin/companies`                          | List companies             |
| POST   | `/superadmin/companies`                          | Create company + Owner     |
| GET    | `/superadmin/companies/:id`                      | Read full company record   |
| PUT    | `/superadmin/companies/:id/settings`             | Update identity / branding |
| POST   | `/superadmin/companies/:id/logo`                 | Upload logo                |
| GET    | `/superadmin/companies/:id/logo`                 | Preview logo               |
| DELETE | `/superadmin/companies/:id/logo`                 | Remove logo                |
| PUT    | `/superadmin/companies/:id/plan`                 | Change plan                |
| PUT    | `/superadmin/companies/:id/status`               | Enable/disable             |
| PUT    | `/superadmin/companies/:id/limits`               | Set limits                 |
| POST   | `/superadmin/companies/:id/reset-owner-password` | Reset password             |

`PUT /superadmin/companies/:id/settings` accepts: `name`, `abbreviation`, `email`, `phone`,
`website`, `tin`, `cac_number`, `address`, `default_currency`, `receipt_footer`,
`header_position`, `use_logo_watermark`. Unknown keys are ignored, and the change is written
to `audit_logs` as `company.identity_updated` with old and new values.

**Owner passwords.** On `POST /superadmin/companies` and
`POST /superadmin/companies/:id/reset-owner-password` the password is optional:

- Omitted → the server generates a strong password (§9) and returns it once, as
  `owner.password` on creation or `password` on reset, with `passwordGenerated: true`.
  The UI shows it in a one-time dialog with copy buttons.
- Supplied → must be at least 8 characters and at most 72 bytes, and is never echoed back.

### Company

| Method | Route               | Purpose                             |
| ------ | ------------------- | ----------------------------------- |
| GET    | `/company/settings` | Read company + branding (read-only) |
| GET    | `/company/logo`     | Company logo image                  |

> Company identity is **read-only** for company users. There is no `PUT /company/settings`
> and no company-side logo upload — those are Super Admin operations (below).

### Customers (people)

| Method | Route                        | Purpose                              |
| ------ | ---------------------------- | ------------------------------------ |
| GET    | `/customers`                 | List with search/filter              |
| GET    | `/customers/search`          | Small lookup for the receipt form    |
| GET    | `/customers/:id`             | One person with attributes           |
| POST   | `/customers`                 | Create                               |
| PUT    | `/customers/:id`             | Update                               |
| DELETE | `/customers/:id`             | Delete                               |
| GET    | `/customers/import/template` | CSV template                         |
| POST   | `/customers/import/validate` | Dry run (no writes)                  |
| POST   | `/customers/import/commit`   | Insert valid rows in one transaction |

`GET /customers`, `GET /customers/:id` and every route that writes are **owner and
administrator only** (§7.3). `GET /customers/search` stays open to all company users
because staff need it to look someone up while issuing a receipt (§7.4).

### Categories

| Method | Route             | Purpose |
| ------ | ----------------- | ------- |
| GET    | `/categories`     | List    |
| POST   | `/categories`     | Create  |
| DELETE | `/categories/:id` | Delete  |

### Items

| Method | Route                    | Purpose      |
| ------ | ------------------------ | ------------ |
| GET    | `/items`                 | List         |
| POST   | `/items`                 | Create       |
| PUT    | `/items/:id`             | Update       |
| DELETE | `/items/:id`             | Delete       |
| GET    | `/items/import/template` | CSV template |
| POST   | `/items/import/validate` | Dry run      |
| POST   | `/items/import/commit`   | Commit       |

### Receipt Configuration

| Method | Route                                       | Purpose              |
| ------ | ------------------------------------------- | -------------------- |
| GET    | `/receipt-config/types`                     | List types + enabled |
| PUT    | `/receipt-config/types/:id/enable`          | Enable               |
| PUT    | `/receipt-config/types/:id/disable`         | Disable              |
| GET    | `/receipt-config/types/:id/fields`          | Master + custom      |
| POST   | `/receipt-config/types/:id/fields`          | Add custom           |
| PUT    | `/receipt-config/types/:id/fields/:fieldId` | Update custom        |
| DELETE | `/receipt-config/types/:id/fields/:fieldId` | Delete custom        |
| GET    | `/receipt-config/types/:id/theme`           | Get theme            |
| PUT    | `/receipt-config/types/:id/theme`           | Set theme            |
| GET    | `/receipt-config/templates`                 | List                 |
| GET    | `/receipt-config/templates/:id`             | Read                 |
| POST   | `/receipt-config/templates`                 | Create               |
| PUT    | `/receipt-config/templates/:id`             | Update               |
| DELETE | `/receipt-config/templates/:id`             | Delete               |

### Receipts

| Method | Route                           | Purpose                           |
| ------ | ------------------------------- | --------------------------------- |
| GET    | `/receipts`                     | List                              |
| GET    | `/receipts/next-options`        | Form options                      |
| GET    | `/receipts/type/:typeId/fields` | Fields for type                   |
| GET    | `/receipts/:id`                 | Read                              |
| GET    | `/receipts/:id/basis`           | Start a new receipt from this one |
| POST   | `/receipts`                     | Create                            |
| POST   | `/receipts/:id/void`            | Void                              |
| GET    | `/receipts/:id/pdf`             | Download PDF                      |

### Reports

| Method | Route                   | Purpose                                            |
| ------ | ----------------------- | -------------------------------------------------- |
| GET    | `/reports/summary`      | Totals, breakdowns and a daily series for a period |
| GET    | `/reports/receipts.csv` | The same period as a spreadsheet                   |

`from` and `to` are plain `YYYY-MM-DD` dates and both default to the current month.
A malformed date, or a `from` after `to`, returns `400`.

The whole router is **owner and administrator only** — §7.4 states staff cannot view
reports. Both routes return the same figures, so the two never disagree.

**How money is counted.** A receipt belongs to the day the payment was made
(`payment_date`, falling back to the creation date), because that is when the money moved.
A **voided** receipt is excluded from every money total — it collected nothing — but is
counted separately as `voided` so the numbers are reconcilable and the record never
vanishes from view.

The CSV export begins with a UTF-8 byte-order mark so Excel reads it correctly, and any
cell starting with `=`, `+`, `-` or `@` is prefixed with an apostrophe so a customer name
cannot be executed as a formula (§38).

### Team (company users)

| Method | Route                       | Purpose                       |
| ------ | --------------------------- | ----------------------------- |
| GET    | `/users`                    | List the company's team       |
| POST   | `/users`                    | Add a member                  |
| PUT    | `/users/:id`                | Edit name, role, active state |
| POST   | `/users/:id/reset-password` | Issue a new password          |

Every route is **owner only** (§7.3) — an administrator cannot change who can sign in.

- `role` must be `admin` or `staff`. `owner` is refused and `super_admin` can never be
  issued here, so a company cannot escalate its own privileges.
- `password` is optional, exactly as on the Super Admin side: omit it and a strong one is
  generated and returned once with `passwordGenerated: true`; supply it and it must be
  at least 8 characters (at most 72 bytes) and is never echoed back.
- A duplicate email returns `409`.
- The owner's own row is refused with `403` — it is managed by the platform administrator.
- There is **no** `DELETE`. Members are referenced by receipts and audit entries, so
  suspending (`is_active: false`) is the correct way to remove access.
- Changes are written to `audit_logs` as `user.created`, `user.updated` and
  `user.password_reset`.

### Verify

| Method | Route                 | Purpose                                     |
| ------ | --------------------- | ------------------------------------------- |
| GET    | `/verify/:token`      | Public verification page (HTML)             |
| GET    | `/verify/:token/data` | Verification result (JSON) the page renders |

Both routes are **public** — they are deliberately not behind the session guard, because the
person scanning a receipt QR code is a customer, auditor or stranger. The data route returns
only the company name, receipt number, date, amount paid and status; it never returns customer
contact details, line items, internal IDs, notes or the token itself. A voided receipt is
returned with `verified: false` and an explanatory message.

---

# PART E — PROCEDURES

## 47. ENVIRONMENT SETUP

1. Install Node.js (LTS).
2. Install PostgreSQL.
3. Create DB: `CREATE DATABASE receipt_system;`
4. Run `schema.sql`.
5. Create `.env`:

   ```
   PORT=3000
   NODE_ENV=development
   DB_USER=postgres
   DB_HOST=localhost
   DB_NAME=receipt_system
   DB_PASSWORD=<password>
   DB_PORT=5432
   SESSION_SECRET=<32+ chars>
   UPLOAD_DIR=uploads
   PUBLIC_BASE_URL=http://localhost:3000
   TRUST_PROXY=false
   ```

   `PUBLIC_BASE_URL` is the address printed into receipt QR codes. Leave it out during local
   development and the incoming request's host is used; **set it in production**, otherwise a
   scanned code would point at whatever `Host` header the request happened to carry.

   `TRUST_PROXY` must be `true` when the app runs behind Nginx/Caddy, otherwise every request
   appears to come from the proxy and rate limiting (§35.1) treats the whole internet as one
   client. Leave it `false` when the app is exposed directly: trusting `X-Forwarded-For` with no
   proxy in front would let a caller spoof its own address.

6. `npm install`.
7. `node mikeadmin.js` — verify.
8. `node server.js` — start.

**Health check confirms:**

- DB reachable
- 27+ tables present
- Plans seeded (2)
- Receipt types seeded (19)
- Super Admin row exists

---

## 48. DEVELOPMENT WORKFLOW

1. `git init` at root.
2. `.gitignore`: `node_modules/`, `.env`, `uploads/`, `*.log`.
3. Commit at every green phase.
4. Follow phases in order.
5. Never build on untested code.

---

## 49. TESTING DISCIPLINE

For every phase:

- Happy path
- Failure paths (missing input, duplicates, permission denied)
- Mobile width
- DB state verification
- Audit log check

**Common tests:**

- Login with wrong password → 401
- Login as disabled user → 403
- Create item over limit → 403
- Duplicate abbreviation → 409
- Access another company's receipt → 404
- Unauthenticated `/superadmin/*` → 401
- Non-super-admin on `/superadmin/*` → 403
- Void without reason → 400
- Receipt with 11 items when limit is 10 → 403

---

## 50. DEPLOYMENT CHECKLIST

- [ ] `NODE_ENV=production`
- [ ] `SESSION_SECRET` rotated
- [ ] HTTPS enabled
- [ ] `cookie.secure = true`
- [ ] DB credentials in environment, not code
- [ ] Migrations applied
- [ ] Super Admin password changed
- [ ] Rate limiting enabled (see §35.1) — and `TRUST_PROXY=true` set if behind a reverse proxy
- [ ] Uploads folder writable
- [ ] Backup cron scheduled
- [ ] Error logging to file or service
- [ ] Process manager (PM2 / systemd)
- [ ] Reverse proxy (Nginx / Caddy) configured
- [ ] DNS and TLS certificates in place

---

## 51. BACKUP & RECOVERY

**Database:**

- Daily `pg_dump` to offsite storage
- Retain 30 days
- Test restore quarterly

**Uploads:**

- Sync `uploads/` to backup storage daily

**Recovery procedure:**

1. Restore database from last dump.
2. Restore uploads.
3. Verify with `mikeadmin.js`.
4. Start server.

**Receipt integrity:** Receipts are never physically deleted; they are voided. Historical numbers remain valid forever.

---

# PART F — BUILD PHASES

## 52. PHASE BREAKDOWN

| Phase | Deliverable                   | Files                                                                                                                                                                 |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Setup, DB, health check       | `schema.sql`, `db.js`, `.env`, `mikeadmin.js`                                                                                                                         |
| 2     | Auth + sessions               | `middleware/auth.js`, `routes/auth.js`, `index.html`, `js/auth.js`, `dashboard.html`                                                                                  |
| 3     | Super Admin dashboard         | `routes/superadmin.js`, `superadmin-dashboard.html`, `js/superadmin.js`                                                                                               |
| 4     | Company settings              | `routes/company.js`, `middleware/upload.js`, `settings.html`, `js/settings.js`                                                                                        |
| 5     | Items + CSV import            | `routes/categories.js`, `routes/items.js`, `middleware/uploadImport.js`, `items.html`, `js/items.js`                                                                  |
| 6a    | Receipt types enable/disable  | `routes/receiptConfig.js`, `receipt-types.html`, `js/receipt-types.js`                                                                                                |
| 6b    | Custom fields                 | (part of 6a)                                                                                                                                                          |
| 6c    | Per-type themes               | `utils/theme.js`, (part of 6a)                                                                                                                                        |
| 6d    | Templates                     | (part of 6a), `templates.html`, `js/templates.js`                                                                                                                     |
| 7     | Receipt issuance              | `routes/receipts.js`, `utils/receiptNumber.js`, `receipts.html`, `receipt-new.html`, `receipt-view.html`, `js/receipts.js`, `js/receipt-new.js`, `js/receipt-view.js` |
| 8     | PDF, QR, verify, print        | `utils/pdf.js`, `routes/verify.js`, `verify.html`, `css/print.css`, `js/verify.js`                                                                                    |
| 9     | Reports                       | `routes/reports.js`, `reports.html`, `js/reports.js`                                                                                                                  |
| 10    | Company users                 | `routes/users.js`, `users.html`, `js/users.js`                                                                                                                        |
| 11    | Polish + role-aware dashboard | (edits across files)                                                                                                                                                  |

Each phase ends with a working, testable feature.

### 52.1 Build status

| Phase | Status       | Notes                                                                                                                                                                                                    |
| ----- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–7   | ✅ Built     | Verified against a live database                                                                                                                                                                         |
| 4     | ⚠️ Re-scoped | Company identity is platform-managed (§11). `settings.js` was removed; the company-side page is informational only.                                                                                      |
| 8     | ✅ Built     | PDF via `utils/pdf.js` (`GET /receipts/:id/pdf`), QR codes carry the `/verify/:token` URL, public verification page. Contrast-safe theme colours and the optional logo watermark are honoured.           |
| 9     | ✅ Built     | `/reports/summary` and `/reports/receipts.csv`, owner/admin only. Voided receipts are excluded from money totals and reported separately; the CSV is BOM-prefixed and guarded against formula injection. |
| 10    | ✅ Built     | `/users` — owner only. Generated passwords shown once, roles limited to admin/staff, the owner row protected, suspension instead of deletion.                                                            |
| 11    | ✅ Built     | `dashboard.html` renders only the tools a role may use; reports and the address book send staff back to the dashboard.                                                                                   |
| —     | ✅ Built     | Customers (§18) — with import, prefill and write-back (§18.1)                                                                                                                                            |

**Not built:** invoices. The invoice module does not exist, so there is no invoice
reporting; reports cover receipts only. This is consistent with §53.

**Still open after Phase 11:**

- `PUBLIC_BASE_URL` should be set in production (§47) so QR links do not depend on the
  incoming `Host` header.
- Rate limiting lives in process memory (§35.1): restarting the server clears it, and it does
  not protect a horizontally scaled deployment.
- The PDF uses PDFKit's built-in fonts, which cannot render the naira glyph, so amounts are
  printed as plain numbers with the currency named once as text.
- WebP logos are skipped by the PDF so it never fails to render; converting them on upload
  would let them appear.

---

# PART G — SCOPE

## 53. VERSION 1 SCOPE

**Included:**

- Super Admin portal
- Company portal
- Company provisioning
- Subscription plans + per-company limits
- Auth with two portals
- Sessions in PostgreSQL
- Company settings (branding, logo, watermark, header position, currency, footer, TIN, CAC)
- Receipt types with enable/disable
- Custom fields per type
- Per-type colors with WCAG-safe contrast
- Templates with default values and items
- Item catalog with CSV import
- Customer management with types
- Bulk import for items, customers, students, tenants, participants
- Receipt issuance with dynamic fields
- Line items with plan limits
- Discount (fixed, percent)
- Payment (method, reference, date)
- Auto payment status
- Receipt numbering `ABBR-YYYY-NNNNN`
- QR verification
- Public verify page
- PDF generation
- Clean printing
- Retrieval with filters
- Reports (basic)
- Audit logs
- Role-aware dashboards
- Responsive UI

## 54. FUTURE SCOPE

- Split payments
- Refund workflows, credit notes
- Expense management, bank reconciliation
- Cashier sessions, multiple branches
- Multiple currencies, tax/VAT
- Inventory management
- Email / WhatsApp / SMS delivery
- Payment gateway integration
- Online payment links
- Self-service subscription billing
- Recurring invoices
- Advanced analytics
- Accounting integrations
- Public API
- Offline / POS capability
- Advanced approval workflows
- Two-factor authentication
- Additional SaaS tiers

## 55. OUT OF SCOPE FOR V1

- Full accounting software
- Payroll
- Warehouse ERP
- Banking software
- School / hospital management
- POS hardware ecosystem

Primary responsibility remains: **Receipt + Invoice + Payment + Verification + Retrieval + Reporting**.

---

# PART H — APPENDICES

## 56. GLOSSARY

| Term                | Meaning                                    |
| ------------------- | ------------------------------------------ |
| Multi-tenant        | One app, many companies                    |
| Tenant              | A company                                  |
| Super Admin         | Platform owner                             |
| Owner               | Company-level admin                        |
| Session             | Server-side auth state                     |
| bcrypt              | Password hashing                           |
| REST                | API style                                  |
| CRUD                | Create/Read/Update/Delete                  |
| Transaction         | Atomic unit of work                        |
| Row-level lock      | Prevents concurrent modification           |
| EAV                 | Entity-Attribute-Value flexible storage    |
| WCAG                | Accessibility guidelines                   |
| Luminance           | Brightness measure                         |
| Idempotency         | Repeat-safe                                |
| Audit trail         | Action log                                 |
| QR verification     | Public authenticity check                  |
| PDFKit              | Node PDF library                           |
| Multer              | Express upload middleware                  |
| pg                  | PostgreSQL client                          |
| Parameterised query | `$1` placeholders — prevents SQL injection |

---

## 57. TEACHING NOTES

**Suggested session plan:**

1. **Context** — Product idea, market, business value
2. **Architecture** — Three-tier diagram, responsibilities
3. **Database** — Schema walkthrough, keys, indexes
4. **Backend setup** — `server.js`, `db.js`, `.env`, health check
5. **Auth** — bcrypt, sessions, cookies, guards
6. **First protected route** — `/auth/me`
7. **Super Admin** — Provisioning flow
8. **Company setup** — Settings, logo, header
9. **Items** — CRUD, plan limits, CSV import
10. **Receipt config** — Types, fields, colors, templates
11. **Receipts** — Issuance, numbering, dynamic fields
12. **PDF + QR** — Generation and verification
13. **Reports** — Aggregates and filters
14. **Users** — Company user management
15. **Review** — Architecture recap, security checklist

**Daily principles to reinforce:**

- Read the error; don't guess
- Log before fixing
- Fix the cause, not the symptom
- Small functions, clear names
- Comment the _why_, not the _what_
- Commit before experimenting
- Ask "what if the user does X?"
- Test on a slow connection
- Ship working code, not perfect code

---

## 58. ACCEPTANCE CRITERIA

The system is accepted when:

1. All build phases complete without errors.
2. All API routes respond with correct status codes.
3. All plan limits enforced server-side.
4. All cross-company access attempts return 404 or 403.
5. All audit actions logged.
6. Every receipt has a unique `ABBR-YYYY-NNNNN` and a UUID token.
7. Every receipt renders correctly as PDF, print, and on-screen.
8. QR codes resolve to the public verify page.
9. Void receipts show VOID on verification.
10. Colors remain readable on every type.
11. Reports match direct SQL aggregates.
12. No plaintext passwords in DB or logs.
13. Uploads rejected if wrong type or too large.
14. Mobile UI usable for creating a receipt end-to-end.
15. No known SQL injection or XSS vectors.

---

**END OF PRD v3.0**

This document is the source of truth for the project. Any deviation during development requires a versioned PRD update approved by the Product Owner.
