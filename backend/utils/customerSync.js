// ============================================================
// utils/customerSync.js — Keep issued receipts and stored people in step
// ============================================================
// A receipt captures a snapshot, so correcting a detail on the form must not
// rewrite history. But the *stored person* should learn from it: if a student
// has moved up a class, the next receipt for them should already say so.
//
// This module decides which receipt fields describe the person rather than the
// transaction, and copies those back onto the customer record.
//
// Deliberately NOT copied back: anything specific to the transaction, such as
// the fee category, the amount, or the session being billed for.
// ============================================================

// Fields that carry the person's name, whatever the receipt type calls them.
const NAME_KEYS = [
    "student_name", "customer_name", "payer_name", "tenant_name", "guest_name",
    "patient_name", "participant_name", "donor_name", "client_name",
];

// Fields that carry an identifier the company uses for that person.
const REFERENCE_KEYS = [
    "student_id", "patient_id", "member_id", "member_no", "tenant_code",
    "registration_number", "employee_id",
];

const PHONE_KEYS = ["customer_phone", "phone", "student_phone", "guardian_phone", "contact_phone"];
const EMAIL_KEYS = ["customer_email", "email", "student_email", "contact_email"];

// Attributes that describe the person and are worth remembering for next time
// (a student's class, a tenant's property). Extend this list as new receipt
// types are added — anything not listed stays purely historical.
const REMEMBERED_ATTRIBUTES = new Set([
    "class", "section", "stream", "department", "programme", "cohort", "level",
    "house", "property", "unit", "room_number", "block", "hostel", "ward", "bed",
    "position", "blood_group",
]);

function firstValue(source, keys) {
    for (const key of keys) {
        const value = source?.[key];
        if (value !== null && value !== undefined && String(value).trim() !== "") {
            return String(value).trim();
        }
    }
    return null;
}

/**
 * Work out what a receipt says about the person it was issued to.
 * @param {{customer_name?: string, customer_phone?: string, customer_email?: string}} receipt
 * @param {Record<string, string>} fieldValues
 */
function personFromReceipt(receipt, fieldValues = {}) {
    const attributes = {};
    for (const [key, value] of Object.entries(fieldValues)) {
        if (!REMEMBERED_ATTRIBUTES.has(key)) continue;
        if (value === null || value === undefined || String(value).trim() === "") continue;
        attributes[key] = String(value).trim();
    }

    return {
        fullName: clean(receipt?.customer_name) || firstValue(fieldValues, NAME_KEYS),
        externalRef: firstValue(fieldValues, REFERENCE_KEYS),
        phone: clean(receipt?.customer_phone) || firstValue(fieldValues, PHONE_KEYS),
        email: clean(receipt?.customer_email) || firstValue(fieldValues, EMAIL_KEYS),
        attributes,
    };
}

function clean(value) {
    return value === null || value === undefined || String(value).trim() === ""
        ? null
        : String(value).trim();
}

/**
 * Copy a receipt's person details onto the stored customer record.
 *
 * Only fills values that are actually present, so an omitted field can never
 * wipe data someone took the trouble to enter. Runs inside the caller's
 * transaction: if the receipt fails to save, the person is left untouched.
 *
 * @param {{query: Function}} client  a pooled client already inside BEGIN
 * @returns {Promise<{ changed: boolean, changes: object }>}
 */
async function syncCustomerFromReceipt(client, companyId, customerId, receipt, fieldValues = {}) {
    if (!customerId) return { changed: false, changes: {} };

    const person = personFromReceipt(receipt, fieldValues);

    const existing = await client.query(
        `SELECT id, full_name, external_ref, phone, email
         FROM customers WHERE id = $1 AND company_id = $2`,
        [customerId, companyId]
    );
    if (existing.rows.length === 0) return { changed: false, changes: {} };

    const current = existing.rows[0];
    const updates = [];
    const values = [];
    const changes = {};

    const maybeUpdate = (column, next) => {
        if (!next) return;
        if (clean(current[column]) === next) return;
        values.push(next);
        updates.push(`${column} = $${values.length}`);
        changes[column] = { from: current[column], to: next };
    };

    maybeUpdate("full_name", person.fullName);
    maybeUpdate("external_ref", person.externalRef);
    maybeUpdate("phone", person.phone);
    maybeUpdate("email", person.email);

    // Attributes live as key/value rows, so they are upserted individually.
    const savedAttributes = {};
    for (const [key, value] of Object.entries(person.attributes)) {
        const previous = await client.query(
            `SELECT profile_value FROM customer_profiles
             WHERE customer_id = $1 AND profile_key = $2`,
            [customerId, key]
        );
        const before = previous.rows[0]?.profile_value ?? null;
        if (before === value) continue;

        await client.query(
            `INSERT INTO customer_profiles (customer_id, profile_key, profile_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (customer_id, profile_key) DO UPDATE SET profile_value = $3`,
            [customerId, key, value]
        );
        savedAttributes[key] = { from: before, to: value };
    }

    if (updates.length) {
        values.push(customerId);
        await client.query(
            `UPDATE customers SET ${updates.join(", ")}, updated_at = NOW()
             WHERE id = $${values.length}`,
            values
        );
    }

    const changed = updates.length > 0 || Object.keys(savedAttributes).length > 0;
    if (changed) changes.attributes = savedAttributes;

    return { changed, changes };
}

module.exports = {
    syncCustomerFromReceipt,
    personFromReceipt,
    NAME_KEYS,
    REFERENCE_KEYS,
    REMEMBERED_ATTRIBUTES,
};
