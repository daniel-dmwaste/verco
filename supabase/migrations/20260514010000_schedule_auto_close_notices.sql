-- =============================================================================
-- pg_cron schedule: auto-close-notices
-- Runs at 18:00 UTC daily = 02:00 AWST
-- Closes NCN/NP records that have been in 'Issued' status for 14+ days
-- with no resident dispute. Per spec §7 + UAT_RUNBOOK.md.
--
-- The auto-close-notices EF has existed since 2026-04-02 but was never
-- scheduled — NCN/NP records would accumulate in Issued forever.
-- UAT exit criteria require dispute lifecycle smoke tests, which need
-- this cron live. Surfaced as P0-3 in UAT_READINESS_REVIEW.md.
-- =============================================================================

-- Idempotent: drop any existing schedule with the same name before re-adding.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-notices') THEN
    PERFORM cron.unschedule('auto-close-notices');
  END IF;
END $$;

SELECT cron.schedule(
  'auto-close-notices',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/auto-close-notices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
