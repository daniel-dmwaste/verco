-- =============================================================================
-- pg_cron schedule: handle-expired-payments
-- Runs at :05 past every hour
-- Handles 6h payment reminders and 24h booking expiry
-- =============================================================================

-- Idempotent: drop any existing schedule with the same name before re-adding.
-- Without this, `pnpm supabase db reset` halts with "duplicate jobname"
-- if the cron table already has a row from a prior apply. P0-8 fix.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'handle-expired-payments') THEN
    PERFORM cron.unschedule('handle-expired-payments');
  END IF;
END $$;

SELECT cron.schedule(
  'handle-expired-payments',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/handle-expired-payments',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
