-- =============================================================================
-- pg_cron schedule: handle-expired-payments
-- Runs at :05 past every hour
-- Handles 6h payment reminders and 24h booking expiry
-- =============================================================================

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
