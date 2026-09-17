-- ============================================================
-- 005 — One value per attribute per person
-- ============================================================
-- customer_profiles is an EAV table: a student's class, a tenant's property.
-- It never had a unique constraint, so the same attribute could be stored more
-- than once for one person, and an upsert was impossible.
--
-- Existing duplicates are collapsed first (keeping the newest row per key),
-- then the constraint is added.
-- ============================================================

DELETE FROM customer_profiles a
USING customer_profiles b
WHERE a.id > b.id
  AND a.customer_id = b.customer_id
  AND a.profile_key = b.profile_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_profiles_customer_key_unique'
    ) THEN
        ALTER TABLE customer_profiles
            ADD CONSTRAINT customer_profiles_customer_key_unique
            UNIQUE (customer_id, profile_key);
    END IF;
END $$;
