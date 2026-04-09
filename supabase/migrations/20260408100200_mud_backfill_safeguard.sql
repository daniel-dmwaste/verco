-- ============================================================================
-- MUD Module — Migration 3/6: backfill safeguard
-- ============================================================================
-- No-op safeguard for any stray is_mud=true rows that might exist between this
-- plan being written and the deploy. Per the live-DB audit (2026-04-08) there
-- are 0 such rows in production today.
--
-- Must run BEFORE migration 4 (constraints) — otherwise a stray row would fail
-- the mud_status_check / mud_cadence_check constraints.
--
-- Default placement is 'Contact Made' + 'Ad-hoc' so the row exists but is not
-- bookable until a human promotes it.
-- ============================================================================

UPDATE public.eligible_properties
   SET mud_onboarding_status = 'Contact Made',
       collection_cadence    = 'Ad-hoc'
 WHERE is_mud = true
   AND mud_onboarding_status IS NULL;
