-- =============================================================================
-- Reschedule nightly-sync-to-dm-ops from 0 12 UTC to 0 19 UTC
-- = 20:00 AWST (business hours) → 03:00 AWST (overnight, per runbook)
--
-- The original migration (20260327120000_nightly_sync_cron.sql) registered
-- the cron at '0 12 * * *' (12:00 UTC = 20:00 AWST), which hits prod during
-- business hours. UAT_RUNBOOK.md and the DM-Ops integration design call for
-- 03:00 AWST overnight. P0-4 in UAT_READINESS_REVIEW.md.
--
-- The non-`!inner` embed concern in the same EF is split out to P1-10 —
-- the natural dm_job_code skip in the aggregation loop handles null bookings
-- correctly (CPPH numbers right; concern is select size, not correctness).
-- =============================================================================

-- Idempotent: drop the existing schedule before re-adding at the new time.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-sync-to-dm-ops') THEN
    PERFORM cron.unschedule('nightly-sync-to-dm-ops');
  END IF;
END $$;

SELECT cron.schedule(
  'nightly-sync-to-dm-ops',
  '0 19 * * *',  -- 19:00 UTC daily = 03:00 AWST (overnight per runbook)
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/nightly-sync-to-dm-ops',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
