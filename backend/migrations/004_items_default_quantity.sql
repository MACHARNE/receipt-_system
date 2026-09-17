-- ============================================================
-- 004 — Default quantity on items
-- ============================================================
-- Lets a product or service carry the quantity it is normally sold in, so the
-- receipt form starts from a sensible number instead of always 1 (for example a
-- "Term" item that is always 1, or printing sold in units of 100).
--
-- This is deliberately NOT stock control. It never decrements and nothing is
-- reserved or tracked; §54 of the PRD still lists real inventory as future
-- scope. It is simply the default the form pre-fills.
-- ============================================================

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS default_quantity NUMERIC(12,3) NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'items_default_quantity_positive'
    ) THEN
        ALTER TABLE items
            ADD CONSTRAINT items_default_quantity_positive CHECK (default_quantity > 0);
    END IF;
END $$;
