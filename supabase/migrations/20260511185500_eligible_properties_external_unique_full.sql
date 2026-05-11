-- ============================================================
-- Replace partial unique index on eligible_properties (external_source, external_id)
-- with a non-partial one.
-- ============================================================
-- The partial filter `WHERE external_source IS NOT NULL` was intended to document
-- that the constraint only applies to imported (Airtable) rows. But Postgres can
-- only use a partial unique index as an ON CONFLICT arbiter when the INSERT
-- statement includes the matching predicate — and Supabase's `upsert(rows, { onConflict })`
-- helper does not emit one. Result: every upsert batch fails with
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Postgres treats NULLs as distinct in UNIQUE indexes by default (`NULLS DISTINCT`),
-- so removing the partial filter does NOT cause conflicts among the existing 18,842
-- KWN rows that have NULL external_source / external_id. Future Airtable-imported
-- rows still get uniqueness on (external_source, external_id) — which is what the
-- import script's ON CONFLICT clause needs.
-- ============================================================

DROP INDEX IF EXISTS idx_eligible_properties_external;

CREATE UNIQUE INDEX idx_eligible_properties_external
  ON eligible_properties (external_source, external_id);
