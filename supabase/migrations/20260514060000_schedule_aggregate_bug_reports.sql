-- =============================================================================
-- pg_cron schedule: aggregate-bug-reports
-- Runs every 4 hours during UAT week (0 */4 * * * UTC).
-- Reads new bug_report rows, clusters via Claude, files Linear tickets.
-- After UAT we'll edit this to daily ('0 19 * * *' = 03:00 AWST).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aggregate-bug-reports') THEN
    PERFORM cron.unschedule('aggregate-bug-reports');
  END IF;
END $$;

SELECT cron.schedule(
  'aggregate-bug-reports',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/aggregate-bug-reports',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
