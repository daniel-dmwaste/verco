-- Unschedule the aggregate-bug-reports pg_cron job.
--
-- Layer 3 of the bug-report pipeline pivoted from an Edge Function + pg_cron
-- to a remote Claude routine (`bug-report-triage`, trig_015oc6WepoDHAkwexMcsSDcu)
-- which runs every 4 hours, queries bug_report via Supabase MCP, files Linear
-- issues via Linear MCP, and updates bug_report.linear_issue_id/status.
--
-- The routine replaces the EF entirely:
--   - no `ANTHROPIC_API_KEY` / `LINEAR_API_KEY` Supabase secrets needed
--   - richer triage (can read the repo to propose file:line-specific fixes)
--   - prompt-edit is the entire update workflow (no redeploy)
--
-- Idempotent: this migration is a no-op if the job already isn't scheduled.
-- The original `20260514060000_schedule_aggregate_bug_reports.sql` stays in
-- git as the creating migration so `db reset` reproduces the lifecycle.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aggregate-bug-reports') THEN
    PERFORM cron.unschedule('aggregate-bug-reports');
  END IF;
END $$;
