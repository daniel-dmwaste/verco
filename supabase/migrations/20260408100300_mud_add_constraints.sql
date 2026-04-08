-- ============================================================================
-- MUD Module — Migration 4/6: CHECK constraints + unique index
-- ============================================================================
-- Encodes the brief's MUD invariants at the DB level:
--   • is_mud=true requires unit_count >= 8 (the 8-unit MUD threshold)
--   • is_mud=true requires mud_onboarding_status set
--   • is_mud=true requires collection_cadence set
--   • Registered status requires strata_contact_id, auth_form_url, and
--     waste_location_notes all populated (the four prereqs to mark a MUD bookable)
--   • mud_code unique per collection_area (matches WMRC convention COT-MUD-01,
--     MOS-MUD-01, etc — area-prefixed, not globally unique)
--
-- These constraints are belt-and-braces alongside the application-layer state
-- machine in src/lib/mud/state-machine.ts. The state machine gives users clear
-- inline errors; these constraints prevent any code path from inserting bad data.
-- ============================================================================

ALTER TABLE public.eligible_properties
  ADD CONSTRAINT eligible_properties_mud_unit_count_check
  CHECK (is_mud = false OR unit_count >= 8);

ALTER TABLE public.eligible_properties
  ADD CONSTRAINT eligible_properties_mud_status_check
  CHECK (is_mud = false OR mud_onboarding_status IS NOT NULL);

ALTER TABLE public.eligible_properties
  ADD CONSTRAINT eligible_properties_mud_cadence_check
  CHECK (is_mud = false OR collection_cadence IS NOT NULL);

ALTER TABLE public.eligible_properties
  ADD CONSTRAINT eligible_properties_registered_check
  CHECK (
    mud_onboarding_status IS DISTINCT FROM 'Registered'
    OR (
      strata_contact_id    IS NOT NULL
      AND auth_form_url    IS NOT NULL
      AND waste_location_notes IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS eligible_properties_mud_code_area_unique
  ON public.eligible_properties(collection_area_id, mud_code)
  WHERE mud_code IS NOT NULL;
