ALTER TABLE receipt_templates
    ADD COLUMN IF NOT EXISTS default_field_values JSONB DEFAULT '{}'::jsonb;
