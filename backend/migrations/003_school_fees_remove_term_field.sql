-- ============================================================
-- 003 — Remove the "Term" field from School Fees receipts
-- ============================================================
-- "Term" duplicated "Academic Session" on the school fees form, so it is removed
-- from the master field set for new receipts.
--
-- Already-issued receipts are deliberately NOT touched. receipt_field_values
-- stores what was actually captured, and both the receipt view and the PDF
-- render those stored values rather than the current master field list. So a
-- receipt issued before this change keeps showing its term; new receipts are
-- simply no longer asked for one.
--
-- Reversal: re-insert the field with
--   INSERT INTO receipt_type_fields
--     (receipt_type_id, field_key, field_label, field_type, is_required, options, display_order)
--   SELECT id, 'term', 'Term', 'select', TRUE,
--          '["First Term","Second Term","Third Term"]'::jsonb, 4
--   FROM receipt_types WHERE code = 'school_fees';
-- ============================================================

DELETE FROM receipt_type_fields
WHERE field_key = 'term'
  AND receipt_type_id = (SELECT id FROM receipt_types WHERE code = 'school_fees');

-- Keep the remaining fields contiguous so the form reads in order.
UPDATE receipt_type_fields SET display_order = 4
WHERE field_key = 'academic_session'
  AND receipt_type_id = (SELECT id FROM receipt_types WHERE code = 'school_fees');

UPDATE receipt_type_fields SET display_order = 5
WHERE field_key = 'fee_category'
  AND receipt_type_id = (SELECT id FROM receipt_types WHERE code = 'school_fees');
