-- =============================================================================
-- pg_cron schedule: nightly-sync-to-dm-ops
-- Runs daily at 12:00 UTC (20:00 AWST)
-- =============================================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Schedule the Edge Function invocation via pg_net
-- pg_cron calls the Supabase Edge Function URL using the service role key
SELECT cron.schedule(
  'nightly-sync-to-dm-ops',
  '0 12 * * *',  -- 12:00 UTC daily = 20:00 AWST
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
