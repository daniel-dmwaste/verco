-- =============================================================================
-- pg_cron schedule: transition-scheduled
-- Runs at 07:25 UTC daily = 15:25 AWST
-- Transitions Confirmed bookings → Scheduled when their earliest collection
-- date is tomorrow (AWST). Cancellation cutoff is 15:30 AWST the day prior.
-- =============================================================================

-- Idempotent: drop any existing schedule with the same name before re-adding.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transition-scheduled') THEN
    PERFORM cron.unschedule('transition-scheduled');
  END IF;
END $$;

SELECT cron.schedule(
  'transition-scheduled',
  '25 7 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/transition-scheduled',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
