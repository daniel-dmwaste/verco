# UAT Readiness Review — Verco v2

**Date:** 2026-05-13
**Reviewer:** Claude Code (project-lead mode), against `VERCO_V2_PRD.md` v1.0, `VERCO_V2_TECH_SPEC.md` v1.0, `CLAUDE.md`, `UAT_RUNBOOK.md`.
**Scope:** Full codebase audit — 201 TS files, 16 Edge Functions, 52 migrations, three route groups, deploy + cron config.
**Method:** Five parallel deep-audit agents (EFs, migrations/RLS, app routes, pricing/state, deploy/infra) + `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:rls`.

---

## TL;DR — verdict: **NO-GO for today**

The build is clean (typecheck ✅, lint ✅, 353/353 unit tests ✅), the pricing math is correct, the booking state machine is correct, and the PII red lines for `field`/`ranger` are properly enforced post-fix-migrations. Foundationally Verco is in good shape.

But two **PII-mutating auth bypasses**, one **missing cron** that breaks NCN/NP closure, and a **broken `db reset` chain** mean putting UAT live today would burn user trust and possibly leak resident data on day one. The fixes are small (~3-4 hours focused work) but have to land before tester #1 logs in.

**Recommendation:** Spend today fixing P0s, smoke against staging tomorrow morning, take UAT live tomorrow afternoon.

---

## 🔴 P0 — UAT-blocking (must fix before live)

| # | Issue | Cite | Why it blocks | Fix scope |
|---|---|---|---|---|
| **P0-1** | **`create-ticket` EF auth bypass — anyone with the public anon key can silently overwrite any contact's PII (`first_name`, `last_name`, `mobile_e164`) by colliding on email.** Auth check is `if (!authHeader)` only — no `auth.getUser()`, no role check. Then service-role client upserts `contacts` by email. | `supabase/functions/create-ticket/index.ts:41-50, 92-118` | Resident PII can be tampered with by anyone who opens DevTools on the public site. Catastrophic in a UAT with council reputation on the line. | Add `await supabase.auth.getUser(token)`; reject if no user OR user role not in `('resident','strata','client-admin','client-staff','contractor-admin','contractor-staff')`; for resident/strata, force `contact.email = user.email` and disallow PII overwrite of other contacts. ~30 min. |
| **P0-2** | **`geocode-properties` EF auth bypass — same pattern.** Header-only check, then service-role mutates up to 50,000 `eligible_properties` rows (lat/lng/google_place_id/formatted_address) per call. | `supabase/functions/geocode-properties/index.ts:33-42` | A bad actor can corrupt the property table or rack up Google Places API spend. Even without malice, an unauthenticated tester clicking around can trigger this. | Validate caller JWT; require `current_user_role() IN ('contractor-admin','client-admin')`. ~30 min. |
| **P0-3** | **`auto-close-notices` cron is not scheduled at all.** EF exists, runbook documents `0 18 * * *`, but no migration calls `cron.schedule('auto-close-notices', ...)`. | `supabase/functions/auto-close-notices/` exists; absent from `supabase/migrations/` | Spec §7 says NCN/NP records auto-close 14 days after `Issued`. They will accumulate forever, breaking the dispute lifecycle and contaminating reports. UAT exit criteria require "≥3 dispute cycles tested" — impossible without this. | New migration mirroring `20260413075037_schedule_handle_expired_payments.sql`. ~10 min. |
| **P0-4** | **`nightly-sync-to-dm-ops` cron schedule mismatch + non-`!inner` embed bug.** Schedule is `0 12 * * *` (20:00 AWST = business hours), runbook expects `0 19 * * *` (03:00 AWST). Also the embed query lacks `!inner`, so PostgREST returns every `booking_item` with null bookings instead of filtering. | Migration: `supabase/migrations/20260327120000_nightly_sync_cron.sql:13`<br>EF: `supabase/functions/nightly-sync-to-dm-ops/index.ts:26-38` | Wrong-time cron will hit prod under load; the embed bug under-aggregates CPPH numbers passed to DM-Ops, corrupting Xero invoicing once the contractor relies on it. | Reschedule cron + add `!inner` to embed. ~20 min. |
| **P0-5** | **Three migration pairs stacked on broken state — `pnpm supabase db reset` will fail.** `20260402141720_allocation_override_service_level.sql` ALTERs a table created later by `20260402150000_allocation_override.sql`. Same anti-pattern: `...142656` vs `...160000`, `...143526` vs `...170000`. | `supabase/migrations/20260402141720_*.sql:1-11` (self-documents the bug, never fixed) | Disaster recovery is broken. Any clean re-apply (e.g. branch-deploys via Supabase MCP, recovery from a Postgres restore) will halt mid-chain. UAT runbook §8 implies clean re-applicability. | Merge each pair into a single migration, or rename to enforce correct order. ~30 min. |
| **P0-6** | **`allocation_rules` / `service_rules` write policies don't gate by role.** Use `accessible_client_ids()` only, which spans `is_contractor_user()` — i.e. **`field` users can mutate pricing and allocation across every client of their contractor**. | `supabase/migrations/20260416092622_allocation_service_rules_write_policies.sql:5-56` | A field user could (accidentally or otherwise) zero out an entire AJA's free allocation, charging residents for what should be included. Contradicts CLAUDE.md §4 PII model and §6 pricing red line. | Add `current_user_role() IN ('contractor-admin','contractor-staff','client-admin','client-staff')` to USING + WITH CHECK. ~15 min. |
| **P0-7** | **`confirm-form.tsx` `console.log`s the full booking body — including resident first_name, last_name, email, mobile, location, notes — in production.** | `src/app/(public)/book/confirm/confirm-form.tsx:282-283` | Goes into browser DevTools (visible to anyone with the resident's device); also gets shipped to any frontend error-monitoring tool. CLAUDE.md §4 PII red line + general data-handling concern. | Delete two lines. ~1 min. |
| **P0-8** | **Cron schedule migrations not idempotent.** `nightly_sync_cron.sql` and `schedule_handle_expired_payments.sql` don't wrap `cron.schedule` in `IF EXISTS cron.unschedule`. | `supabase/migrations/20260327120000_nightly_sync_cron.sql`<br>`supabase/migrations/20260413075037_schedule_handle_expired_payments.sql` | Re-applying breaks with "duplicate jobname". Combined with P0-5, recovery is broken. | Wrap both in the `DO $$ IF EXISTS cron.unschedule $$ END` pattern from the other cron migrations. ~10 min. |
| **P0-9** | **Missing env vars in `.env.example`** — `SITE_URL`, `APP_URL`, `DM_OPS_SUPABASE_URL`, `DM_OPS_SUPABASE_SERVICE_ROLE_KEY`, `DEFAULT_FROM_EMAIL`, `LOCAL_DEV_CLIENT_SLUG` are all referenced in code/docs but absent. | `.env.example:32-44`; refs in `supabase/functions/`, CLAUDE.md §21 | Anyone re-bootstrapping EF secrets from `.env.example` deploys functions that fall back to `undefined` — silent broken callbacks, broken email sender, broken DM-Ops sync. | Append the six vars with comments. ~5 min. |

**Total P0 effort: ~3 hours.**

---

## 🟡 P1 — High risk, fix during UAT week (not blocking)

| # | Issue | Cite | Mitigation |
|---|---|---|---|
| P1-1 | **`can_cancel_booking()` RPC doesn't exist** despite CLAUDE.md §7 mandating "always check it before showing the cancel UI." Currently the Node-side cutoff check in `actions.ts:86-107` is the only gate; `enforce_cancellation_cutoff` trigger has a `Submitted` carve-out. | absent in `supabase/migrations/`; ref in CLAUDE.md §7 | Add the RPC; remove the trigger carve-out. Defence-in-depth against accidental late-cancellations. |
| P1-2 | **`create-booking` doesn't compare client price to server-recalculated price.** Server price wins (so no resident overcharge), but the spec says reject mismatches to surface client/server drift. | `supabase/functions/create-booking/index.ts:169-186` | Add a `total_cents_expected` field to the request schema; reject with 409 on mismatch. Useful for catching `services-form.tsx` ↔ `_shared/pricing.ts` divergence. |
| P1-3 | **`config.toml` has `email_sent = 2` (dev default) in the auth rate-limit section.** Per CLAUDE.md §21 — `supabase config push` will silently rate-limit prod auth emails to 2/hour. | `supabase/config.toml:182` | Bump to 30+ for prod, OR explicitly diff before any future `config push`. **Do not run `config push --yes` until this is fixed.** |
| P1-4 | **Generic "Internal Server Error" in catch blocks** in `calculate-price`, `google-places-proxy`, `process-refund`. Violates CLAUDE.md §11 ("return `err.message`"). | `supabase/functions/calculate-price/index.ts:101-105`, `google-places-proxy/index.ts:101-105`, `process-refund/index.ts:135-142` | Replace with `err.message`. Without this, UAT triage from EF logs is much slower. |
| P1-5 | **No NCN-resolved → refund-review automation.** Spec §5.4 implies a paid booking that lands in `Non-conformance` should auto-create a `refund_request`. NCN actions only update status. | `src/app/(admin)/admin/non-conformance/[id]/actions.ts:22-37` | Either add a DB trigger on NCN→Resolved-with-paid-items, or surface a "Initiate refund review" button in the NCN detail panel. |
| P1-6 | **`booking_payment` and `contacts` have no INSERT/UPDATE policies** — all writes must route via service-role EFs. Functionally OK today, but any future direct write from app code will silently fail with no error. | `supabase/migrations/20260326053510_initial_schema.sql:1028-1052`, `20260401100001_*.sql` | Either add explicit deny policies (so writes 403 instead of silently failing), or document the constraint in CLAUDE.md §21. |
| P1-7 | **RLS test suite skips by default** — needs `SUPABASE_DB_URL` set. UAT runbook §8 says run weekly. Currently 0 of 31 tests run in CI. | `src/__tests__/rls.test.ts:111,175,183` | Add `SUPABASE_DB_URL` (read-only service-role connection to a dedicated test DB) to CI secrets. Make it required during UAT week. |
| P1-8 | **No DB-level state machine test.** TS `state-machine.test.ts` covers `lib/booking/state-machine.ts`; SQL `enforce_booking_state_transition` trigger is untested. Drift between TS list and SQL `CASE` is silent. | `supabase/migrations/20260326053510_initial_schema.sql:704-731` | Add an RLS-test-style integration test that attempts each invalid transition via SQL and asserts rejection. |
| P1-9 | **`stripe-webhook` updates `booking_payment.status='paid'` BEFORE booking transition.** If the booking transition fails, payment row is `paid` but booking remains `Pending Payment` — drift. | `supabase/functions/stripe-webhook/index.ts:170-178` | Reorder: update booking first, payment second. Or wrap in a single SQL function. |

---

## 🟠 P2 — Hygiene + DX (defer; bundle with P1 work)

- **White-label hex sweep** (UI_UX_AUDIT.md P1) — 282 hardcoded `#293F52` across 54 files. Public/field paths leak D&M branding regardless of `client.primary_colour`. ~3-4 hr per UI_UX_AUDIT estimate. Not blocking UAT for KWN/WMRC because their primary_colour is close to D&M navy, but should land before any third council comes on.
- **Shared `<VercoButton>` component** (UI_UX_AUDIT P2) — every button hand-rolled. ~1-2 hr.
- **Loading states + status-style configs** (UI_UX_AUDIT P3, P5) — ~1.5 hr.
- **`create-user/index.ts:289-322`** sends welcome email with hardcoded `noreply@verco.au` and `'#293F52'`, bypassing per-client `reply_to_email` / `email_from_name` / `primary_colour`. Resident sees D&M branding on a Verge Valet welcome email.
- **`booking_state_machine` BEFORE UPDATE OF status** trigger — same-status no-op UPDATEs (e.g. rebook re-issuing `Cancelled→Cancelled`) silently pass without firing. Low risk; document.
- **Three legacy `is_field_user()` SELECT policies** on NCN/NP (`initial_schema.sql:1163, 1183`). Rows themselves carry no PII, but ensure no `.select('*, reported_by:profiles(...)')` exists in field code.
- **Two more MCN/NP `is_contractor_user()` checks via embed risk** — verify `field` doesn't reach `profiles` rows via `reported_by`/`resolved_by` FKs.

---

## 🟢 What's solid (don't touch)

- **PII red lines**. `field`/`ranger` correctly excluded from `contacts.full_name`/`email`/`mobile_e164` at RLS level (`20260508045155_fix_profiles_pii_field_exclusion.sql` + `20260329110000_fix_pii_field_role_exclusion.sql`); run-sheet query structurally excludes them.
- **Pricing engine math**. Dual-limit (`MIN(qty, category_remaining, service_remaining)`) and "paid units don't consume category budget" both correct in `_shared/pricing.ts:166-170` and `lib/pricing/calculate.ts:107-111`. Authoritative + Node mirror match. 38 unit tests cover MIN-binding, cross-line interaction, override math.
- **Booking state machine**. Trigger covers all 12 transitions per CLAUDE.md §7. Only `transition-scheduled/index.ts:71` writes `'Scheduled'`. Resident dispute flow RLS-constrained to `Issued → Disputed` on own bookings.
- **Capacity concurrency**. `create_booking_with_capacity_check` RPC with serializable txn + advisory lock keyed on `collection_date_id` (or `capacity_pool_id` for pooled areas). `create-booking` EF correctly routes through it.
- **Stripe webhook**. HMAC verified, idempotent on `stripe_session_id`, only writes `Pending Payment → Submitted`.
- **Audit triggers**. Cover `booking`, `booking_item`, NCN, NP, service_ticket, ticket_response, collection_date, contacts, eligible_properties, allocation_override, allocation_rules, service_rules, refund_request, strata_user_properties.
- **Magic Link template**. `supabase/templates/magic_link.html` uses only `{{ .Token }}` — no sprig, no `{{ now }}`. CLAUDE.md §21 gotcha respected.
- **Deploy pipeline**. `deploy.yml` pre-deploy guard greps for `SUPABASE_SERVICE_ROLE_KEY` in `src/`. `NEXT_PUBLIC_*` vars correctly threaded ARG → ENV → build-arg → GitHub secret. Health endpoint returns SHA, deploy.yml polls and matches.
- **Tooling.** `pnpm tsc --noEmit` clean. `pnpm lint` clean. `pnpm test` 353/353 pass in 9.25s. Required scripts (`test:rls`, `test:e2e`, `test:coverage`, `typecheck`) all present.

---

## Refactor / fix plan — ordered for today

### Stream A — P0 fixes (one branch per logical change; ~3 hours)

```
1.  fix(security): require valid JWT + role in create-ticket EF        (P0-1, ~30m)
2.  fix(security): require contractor/client-admin role in geocode EF  (P0-2, ~30m)
3.  feat(cron): schedule auto-close-notices                             (P0-3, ~10m)
4.  fix(cron): correct nightly-sync schedule to 0 19 UTC + add !inner   (P0-4, ~20m)
5.  fix(migrations): merge Apr-2 allocation_override pairs              (P0-5, ~30m)
6.  fix(rls): role-gate allocation_rules + service_rules writes         (P0-6, ~15m)
7.  fix(book): remove PII console.log from confirm-form                 (P0-7, ~1m)
8.  fix(cron): wrap nightly-sync + handle-expired in unschedule guard   (P0-8, ~10m)
9.  chore(env): add 6 missing vars to .env.example                      (P0-9, ~5m)
```

After each commit: `pnpm tsc && pnpm lint && pnpm test`. After all nine: `pnpm test:rls` against staging DB (this requires `SUPABASE_DB_URL` — see P1-7).

### Stream B — UAT entry criteria (parallel, today)

- [ ] Apply P0 migrations to staging Supabase, verify `cron.job` table has all 4 jobs at correct AWST times
- [ ] Run `pnpm supabase db reset` against a scratch project end-to-end — must complete clean (validates P0-5)
- [ ] Run `pnpm test:rls` against staging — all 31 tests must pass (validates PII red line + RLS coverage)
- [ ] Smoke: free booking, paid booking (Stripe test card), NCN dispute, MUD allocation entry, ranger ID booking
- [ ] Confirm SendGrid magic-link delivery from `verco.au` reaches Gmail + Outlook + a council mail server
- [ ] Confirm `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard's signing secret (UAT runbook §3)
- [ ] Set `SUPABASE_DB_URL` in CI → activates RLS test job

### Stream C — UAT-week follow-ups (P1, deferred)

- [ ] `can_cancel_booking()` RPC + remove `Submitted` carve-out in `enforce_cancellation_cutoff`
- [ ] Fix the four "Internal Server Error" catch blocks
- [ ] Reorder Stripe webhook payment-vs-booking update
- [ ] NCN-resolved → refund-review automation (spec §5.4)
- [ ] Bump `auth.rate_limit.email_sent` in `config.toml` to a prod-safe value

### Stream D — post-UAT (P2)

- White-label hex sweep (UI_UX_AUDIT P1)
- `<VercoButton>` (UI_UX_AUDIT P2) + loading states (P3) + status-style configs (P5)
- A11y quick wins (UI_UX_AUDIT P6)

---

## What this review did NOT cover

- **Live SendGrid deliverability + DKIM/SPF/DMARC** — runbook says these are good; not re-verified
- **Stripe live-mode webhook signature** — not testable from sandbox
- **Coolify deploy state** — out of sandbox reach; check via `gh run list --workflow=deploy.yml --limit=5`
- **Attio CRM sync** — referenced in spec §13.7 but not audited end-to-end (low risk for UAT scope)
- **Lighthouse / WCAG 2.1 AA scores** (NFR target ≥85 / WCAG AA on public flow) — UI_UX_AUDIT P6 covers a11y quick wins; full audit deferred
- **Playwright E2E suite** — `test:e2e` script exists, not run in this review (would need browser + dev server)

---

*Review produced from a clean working tree on `claude/review-uat-readiness-XuPO2`. Spec docs read in full; codebase audited via 5 parallel agents covering EFs, migrations/RLS, app routes, pricing/state, deploy/infra. All file:line citations are current as of HEAD `a860177`.*
