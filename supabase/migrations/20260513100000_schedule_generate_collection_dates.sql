-- =============================================================================
-- pg_cron schedule: generate-collection-dates
-- Runs at 19:00 UTC daily = 3am AWST next day.
-- Generates the next 16 weeks of collection_date + collection_date_pool rows
-- from collection_schedule, capacity_pool_schedule, and public_holiday.
-- Idempotent (ON CONFLICT DO NOTHING) so daily runs are safe.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-collection-dates') THEN
    PERFORM cron.unschedule('generate-collection-dates');
  END IF;
END $$;

SELECT cron.schedule(
  'generate-collection-dates',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/generate-collection-dates',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
