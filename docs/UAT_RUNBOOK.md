# UAT Runbook — Verco v2

**Audience:** Dan + on-call (himself for now). Quick-reference for triaging issues during the UAT window with KWN + WMRC staff.

**Scope:** Production observability without Sentry. Use this until M5/Sentry decision is made.

---

## 1. Where the parts live

| Component | Where | How to access |
|---|---|---|
| **Next.js app** (resident, admin, field UIs) | Coolify on BinaryLane | https://coolify.binarylane.com.au — Verco app dashboard |
| **Edge Functions** (Stripe webhook, cron jobs, notifications) | Supabase EFs | https://supabase.com/dashboard/project/tfddjmplcizfirxqhotv/functions |
| **Postgres + RLS + cron schedules** | Supabase | https://supabase.com/dashboard/project/tfddjmplcizfirxqhotv/editor |
| **Email delivery** | SendGrid (`u50012713`, cluster `wl214`) | https://app.sendgrid.com → Activity |
| **Stripe payments** | Stripe Dashboard | https://dashboard.stripe.com/payments — filter by client account |
| **DNS** | Netregistry | https://console.netregistry.com.au |
| **Code** | GitHub `daniel-dmwaste/verco` | Actions tab for CI/deploy runs |

---

## 2. First 60 seconds when something looks wrong

1. **Identify the surface.** Resident-facing? Admin-only? Field-only? Cron-driven?
2. **Check Coolify deploy state.** `gh run list --workflow=deploy.yml --limit=5` — last entry should be `success`. If `cancelled` or `failed`, prod may be running an older image than `main` HEAD.
3. **Check the relevant log layer:**
   - User-facing 500 → Coolify container logs
   - Email not arriving → SendGrid Activity dashboard (filter by recipient or last hour)
   - Booking stuck in `Pending Payment` past 24h → `handle-expired-payments` EF logs
   - NCN/NP not closing after 14 days → `auto-close-notices` EF logs
   - Booking not transitioning Confirmed→Scheduled → `transition-scheduled` EF logs
4. **Reproduce if you can.** Use the same browser the tester used (mobile vs desktop matters). Check `/api/health` for the deployed git SHA.
5. **Triage to one of:** code bug, config drift, infra (Coolify/Supabase/SendGrid), user error, deliberate UAT feedback.

---

## 3. Common signals + first action

### Tester says "I can't log in"
- **Most common cause:** OTP email landed in spam.
- **Action:** Check SendGrid Activity → search by email. If `delivered`, ask tester to check spam. If `dropped` / `bounced`, address is invalid or our domain reputation has slipped (rare; verco.au DKIM + SPF + DMARC are all live).
- **Less common:** multi-role user hitting the proxy. After PR #15 this should be fixed — confirm by checking Coolify logs for `[proxy]` entries.

### Tester says "Booking didn't go through"
- **Free booking:** check `booking` table in Supabase → filter by `created_at` past 10 min. If row exists, it succeeded — they may have missed the confirmation page. If no row, check Coolify logs for `create-booking` errors.
- **Paid booking stuck in Pending Payment:**
  - Stripe webhook not firing → check Stripe Dashboard → Webhooks → recent attempts. Look for non-200 responses.
  - Webhook firing but signature failing → check `stripe-webhook` EF logs in Supabase. Means `STRIPE_WEBHOOK_SECRET` drifted from Stripe's signing secret.
  - Booking >24h old → `handle-expired-payments` should have cancelled it. Check that cron's last run.

### "I got an NCN but didn't dispute and it's still showing as Issued after 2 weeks"
- **Cron `auto-close-notices` runs daily at 02:00 AWST.** Check `cron.job_run_details` in Supabase SQL editor:
  ```sql
  SELECT * FROM cron.job_run_details
  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auto-close-notices')
  ORDER BY start_time DESC LIMIT 5;
  ```
  Look for `status = 'failed'` or `return_message` containing 500. After PR #13 the EF returns 500 on per-row failure — that surfaces here.

### "Field crew can see resident contact info on run sheet"
- **This would be a Red Line breach (CLAUDE.md §4).** Verify immediately:
  ```sql
  -- As a sanity check, run with a test field user's UUID
  SELECT current_setting('request.jwt.claims', true);
  ```
  Or run `pnpm test:rls` locally — TC-PII-001/002 should still be passing. If they fail, halt UAT and investigate.

### Coolify says deploy failed
- Check `gh run view <run-id> --log` for the failed job's last lines.
- Most common cause: `pnpm install --frozen-lockfile` mismatch. Solution: regenerate lockfile locally, commit, push.

---

## 4. Direct command reference

### Recent Coolify deploys
```bash
gh run list --workflow=deploy.yml --limit=10
gh run view <id> --log | tail -100
```

### Edge Function logs (last 24h)
Via Supabase MCP: `get_logs(project_id="tfddjmplcizfirxqhotv", service="edge-function")`. Or in the dashboard: Functions → click EF → Logs tab.

### Postgres logs (errors, slow queries, locks)
Via Supabase MCP: `get_logs(project_id="tfddjmplcizfirxqhotv", service="postgres")`. Or dashboard: Logs → Postgres.

### Cron job state
```sql
SELECT jobname, schedule, active FROM cron.job;
SELECT jobid, status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE start_time > now() - interval '24 hours'
ORDER BY start_time DESC;
```

### SendGrid recent activity
SendGrid → Activity → filter last hour. Bounced/dropped should be under 5%.

---

## 5. Cron schedules (so you know what's normal)

| EF | Schedule (UTC) | AWST | Purpose |
|---|---|---|---|
| `auto-close-notices` | `0 18 * * *` | 02:00 next day | Close NCN/NP older than 14 days |
| `nightly-sync-to-dm-ops` | `0 19 * * *` | 03:00 next day | Sync to DM-Ops Supabase |
| `transition-scheduled` | `25 7 * * *` | 15:25 same day | Confirmed → Scheduled day before collection |
| `handle-expired-payments` | `5 * * * *` | every hour | 6h reminder + 24h cancel for Pending Payment |

A missed run on any of these is a P2 incident — investigate within 1 business day.

---

## 6. Escalation

For UAT (small group, KWN + WMRC staff), escalation is just Dan. If something genuinely critical and Dan isn't reachable:

1. **Database integrity issue** (data corruption, migration failure): contact Supabase support via dashboard support ticket.
2. **Coolify down** (no Next.js routing): contact BinaryLane support.
3. **Stripe** (charges failing, refunds stuck): Stripe Dashboard → Help → contact support. Don't initiate refunds without Dan's sign-off.

For known issue patterns or process improvements, log a Linear issue in the Verco project and tag with `UAT`.

---

## 7. Things to NOT do during UAT

- Don't `pnpm supabase db reset` against prod (obvious, but worth saying).
- Don't push directly to `main` — always via PR with CI green.
- Don't disable RLS on a table to "investigate." Use the Supabase MCP `execute_sql` with service role for read access; never relax policies as a debug shortcut.
- Don't process refunds via direct DB updates. Use the `process-refund` Edge Function so Stripe stays in sync.
- Don't share the database password, service role key, or DB URL with testers. Even Dan-managed credentials shouldn't appear in conversation transcripts (rotate if they do).

---

## 8. UAT exit criteria checklist

- [ ] Zero P1/P2 incidents over a 5-day window
- [ ] At least 10 paid bookings completed end-to-end (free → confirm → schedule → complete OR cancel-with-refund)
- [ ] At least 3 NCN-by-resident dispute cycles tested
- [ ] All 4 cron jobs ran successfully every day for 5 consecutive days
- [ ] No PII leak signals in `pnpm test:rls` (run weekly)
- [ ] SendGrid bounce rate < 5%, spam reports < 0.1%
- [ ] At least one MUD/strata booking booked + completed

When all green, UAT can promote to general availability.
