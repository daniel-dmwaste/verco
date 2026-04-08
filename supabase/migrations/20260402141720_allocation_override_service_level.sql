-- Recovered from live DB migration history on 2026-04-08.
-- This migration was applied directly via Supabase Studio and never committed
-- to git. Reconstructed verbatim from supabase_migrations.schema_migrations.
--
-- KNOWN ISSUE: timestamp ordering
-- This migration ALTERs allocation_override (DROP category_id, ADD service_id),
-- but the table-creation migration is at 20260402150000 (later). On a fresh
-- `supabase db reset` this would fail because the table doesn't exist yet.
-- The live DB applied them in author order, not timestamp order.
-- Cleanup: rename one or both to fix the chronology before any db reset.

-- Change allocation_override from category-level set_remaining to service-level extra_allocations
-- The pricing engine will roll up service extras to the parent category automatically

ALTER TABLE allocation_override DROP COLUMN category_id;
ALTER TABLE allocation_override ADD COLUMN service_id uuid NOT NULL REFERENCES service(id);
ALTER TABLE allocation_override RENAME COLUMN set_remaining TO extra_allocations;

-- Replace the old category index with a service index
DROP INDEX IF EXISTS idx_allocation_override_category;
CREATE INDEX idx_allocation_override_service ON allocation_override(service_id, fy_id);
