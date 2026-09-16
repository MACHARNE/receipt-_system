UPDATE receipt_type_fields
SET options = '["First Term", "Second Term", "Third Term"]'::jsonb
WHERE field_key = 'term'
  AND receipt_type_id = (SELECT id FROM receipt_types WHERE code = 'school_fees')
  AND (options IS NULL OR options = '[]'::jsonb);
