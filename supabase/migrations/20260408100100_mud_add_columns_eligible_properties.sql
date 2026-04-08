-- ============================================================================
-- MUD Module — Migration 2/6: eligible_properties columns
-- ============================================================================
-- Adds 7 new columns to eligible_properties to scaffold MUD onboarding data.
-- All new columns are nullable (or have defaults) so existing SUD rows are
-- unaffected. CHECK constraints applied in Migration 4 enforce required-ness
-- on the is_mud=true subset.
--
-- Note: this is additive only. ALTER COLUMN ... NOT NULL would break existing
-- ~19 SUD rows. The CHECK constraints in migration 4 enforce conditional
-- required-ness for is_mud=true rows.
-- ============================================================================

ALTER TABLE public.eligible_properties
  ADD COLUMN IF NOT EXISTS unit_count            integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mud_code              text NULL,
  ADD COLUMN IF NOT EXISTS mud_onboarding_status mud_onboarding_status NULL,
  ADD COLUMN IF NOT EXISTS waste_location_notes  text NULL,
  ADD COLUMN IF NOT EXISTS auth_form_url         text NULL,
  ADD COLUMN IF NOT EXISTS strata_contact_id     uuid NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS collection_cadence    collection_cadence NULL;

CREATE INDEX IF NOT EXISTS idx_eligible_properties_strata_contact
  ON public.eligible_properties(strata_contact_id);
