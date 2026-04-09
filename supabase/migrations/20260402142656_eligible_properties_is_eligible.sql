-- Recovered from live DB migration history on 2026-04-08.
-- This migration was applied directly via Supabase Studio and never committed
-- to git. Reconstructed verbatim from supabase_migrations.schema_migrations.

-- Add is_eligible flag for properties where council offers tip passes in lieu of service
ALTER TABLE eligible_properties ADD COLUMN is_eligible boolean NOT NULL DEFAULT true;
CREATE INDEX idx_eligible_properties_is_eligible ON eligible_properties(is_eligible) WHERE NOT is_eligible;
