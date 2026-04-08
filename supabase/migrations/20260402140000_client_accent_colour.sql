-- Recovered from live DB migration history on 2026-04-08.
-- This migration was applied directly via Supabase Studio and never committed
-- to git. Reconstructed verbatim from supabase_migrations.schema_migrations.

ALTER TABLE client ADD COLUMN accent_colour text;
