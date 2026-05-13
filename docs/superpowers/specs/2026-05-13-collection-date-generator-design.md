# Collection Date Generator — Design Spec

**Date:** 2026-05-13
**Author:** Dan Taylor + Claude
**Status:** Approved + shipped (Dan delegated implementation 2026-05-13)
**Related work:** Follow-up to [#26](https://github.com/daniel-dmwaste/verco/pull/26) (rules seed) and [#27](https://github.com/daniel-dmwaste/verco/pull/27) (capacity_pool)

---

## Problem

The booking flow needs `collection_date` rows to exist before residents can book — and for pooled areas it also needs matching `collection_date_pool` rows. Today both tables are empty for VV. Someone has to populate them, idempotently, for the next ~16 weeks, on a daily cadence.

A second concern: WA public holidays fall on regular collection days a handful of times per year. Residents must NOT be able to book those days.

## Scope (v1)

- Daily cron Edge Function that generates the next 16 weeks of `collection_date` + `collection_date_pool` rows from declarative schedule tables.
- Public-holiday awareness: holiday-dated rows are created with `is_open=false` / `is_closed=true` so they're visible to admin but unbookable.
- VV-only seed (KWN can be added later by inserting `collection_schedule` rows).
- Idempotent via UNIQUE constraints + `ON CONFLICT DO NOTHING`.

## Out of scope (deferred)

- **Automatic reschedule on holidays** — if D&M wants to collect Tue when Mon is a holiday, ops manually `INSERT` a one-off `collection_date`. Auto-reschedule has too many design questions for v1 (which day shifts, do all pool members shift together).
- **Admin UI for managing schedules and holidays** — SQL only for v1.
- **Holiday substitution computation** — substitution dates (ANZAC on Sun → Mon, Boxing Day on Sat → Mon) are hardcoded in the holiday seed rather than computed from rules.
- **Beyond mid-2027** — holiday list needs an annual reseed. Track as 12-month checklist.
- **Schedule change propagation** — `ON CONFLICT DO NOTHING` means a schedule update doesn't retroactively change existing future dates. Ops would `UPDATE` directly or future-date the change.

## Architecture

### Schema

```sql
CREATE TABLE collection_schedule (
  id, collection_area_id, day_of_week (0-6, Sun=0),
  bulk_capacity_limit, anc_capacity_limit, id_capacity_limit,
  is_active, created_at, updated_at,
  UNIQUE (collection_area_id, day_of_week)
);

CREATE TABLE capacity_pool_schedule (
  id, capacity_pool_id, day_of_week,
  bulk_capacity_limit, anc_capacity_limit, id_capacity_limit,
  is_active, created_at, updated_at,
  UNIQUE (capacity_pool_id, day_of_week)
);

CREATE TABLE public_holiday (
  id, date, name,
  jurisdiction (default 'WA'),
  UNIQUE (jurisdiction, date)
);
```

All three: public SELECT (mirrors existing pattern for unauthenticated booking flow), contractor-admin write.

### Data flow

1. Cron fires at 19:00 UTC daily (= 3am AWST next day).
2. EF reads `collection_schedule` (active), `capacity_pool_schedule` (active), and `public_holiday` rows in the upcoming window in parallel.
3. EF enumerates dates in `[today, today + 16*7 days)`, intersects with each schedule's `day_of_week`.
4. For each match: emit one row per `(entity, date)` tagged with the schedule's capacity limits and whether the date is a holiday.
5. Upsert into `collection_date` (per-area) with `is_open=NOT is_holiday`. On a holiday: capacity_limits=0 too.
6. Upsert into `collection_date_pool` with `*_is_closed=is_holiday`. On a holiday: capacity_limits=0 too.
7. Both upserts use `ignoreDuplicates: true` (ON CONFLICT DO NOTHING).
8. Return JSON with row counts; HTTP 500 if any per-step write failed.

### Pool capacity comes from the pool's own schedule

Pool-member areas (MOS, COT, PEP, FRE-N) have `bulk_capacity_limit=0` on their per-area `collection_schedule` rows because per-area capacity counters are unused for pooled areas (per the capacity_pool design). The actual 60 lives on `capacity_pool_schedule` for the MCP pool's Mon + Wed entries.

This keeps the per-area `collection_date` row's capacity at 0, matching the "pooled areas don't use their own counters" invariant from the capacity_pool design.

### Holiday handling — visible-but-closed pattern

Rejected alternative: skip holiday dates entirely (don't create rows). Chosen: create with `is_open=false`. Why:

- Admin staff see "Mon 1 Jun 2026 — WA Day, closed" in any calendar view; clear context for ops.
- Booking flow already filters `is_open=true` so residents won't see them.
- Symmetric with per-pool: pool row also exists with `bulk_is_closed=true`, so the RPC's "no pool row → exception" guard isn't triggered if someone tries to force-book a holiday.

## Migration order

1. `20260513090000_collection_schedule.sql` — schema + seed (17 VV schedule rows, 2 MCP pool schedule rows, 11 WA holidays)
2. EF deployed via `apply_migration`+`deploy_edge_function` MCP calls (not a `.sql` migration — the EF lives in `supabase/functions/`)
3. EF invoked once for initial backfill → 272 area dates + 32 pool dates created
4. `20260513100000_schedule_generate_collection_dates.sql` — `pg_cron.schedule` registers the daily 19:00 UTC run

Sequence matters: the cron migration depends on the EF being deployed (otherwise the first cron fire would 404).

## Idempotency model

- UNIQUE `(collection_area_id, date)` on `collection_date` and `(capacity_pool_id, date)` on `collection_date_pool` are the conflict targets.
- `upsert(...)` with `ignoreDuplicates: true` means existing rows are untouched — manual ops adjustments (e.g. "cut Mon 25 May cap to 40 for fleet maintenance") survive subsequent cron runs.
- A separate `--regenerate` mode (with `ignoreDuplicates: false`) is a future option if we ever need bulk schedule changes to retro-apply. Not built in v1.

## Schedule change behaviour

If `collection_schedule.bulk_capacity_limit` changes from 60 to 80, **existing future `collection_date` rows are NOT updated**. The cron only writes new (area, date) rows that don't already exist.

To propagate a schedule change:
- For future dates only: ops runs `UPDATE collection_date SET bulk_capacity_limit = 80 WHERE collection_area_id = ? AND date > ?`.
- For new dates further out: the next cron run uses the new schedule.

This is a deliberate "operator-driven retroactive change" model, not "schedule-driven retroactive change".

## Holiday seed — 2026 May → 2027 June

| Date | Name | Notes |
|---|---|---|
| 2026-06-01 | WA Day | Mon |
| 2026-09-28 | King's Birthday | Mon |
| 2026-12-25 | Christmas Day | Fri |
| 2026-12-28 | Boxing Day (observed) | Mon — Sat Dec 26 substitutes Mon Dec 28 in WA |
| 2027-01-01 | New Year's Day | Fri |
| 2027-01-26 | Australia Day | Tue |
| 2027-03-01 | Labour Day | Mon |
| 2027-03-26 | Good Friday | Fri |
| 2027-03-29 | Easter Monday | Mon |
| 2027-04-26 | ANZAC Day (observed) | Mon — Sun Apr 25 substitutes Mon Apr 26 in WA |
| 2027-06-07 | WA Day | Mon |

Sat/Sun holidays not falling on a collection day are omitted. Annual reseed required.

## RLS

All three new tables enable RLS:
- Public SELECT — booking flow reads schedules indirectly (and admin reads holiday names for context).
- Contractor admin/staff: full write within own contractor scope.
- Service-role (used by EF + cron) bypasses RLS as expected.

## Testing

Vitest unit tests for the pure planner in [src/lib/scheduling/collection-dates.ts](src/lib/scheduling/collection-dates.ts):
- `enumerateDates` — month/year/leap-year boundaries, empty range
- `dayOfWeek` — matches Postgres EXTRACT(DOW)
- `windowFromToday` — 16-week horizon math
- `planDates` — basic matching, holiday tagging, multiple entries per weekday, missing-weekday skip

Integration testing via:
- Initial backfill invocation verified expected row counts (272 area + 32 pool) and holiday handling for WA Day.

Out-of-scope tests:
- Concurrent EF invocations (cron only fires once daily; unlikely race in practice).
- RLS smoke tests for the new tables.

## Risks

- **Holiday list drift** — if ops doesn't reseed 12 months ahead, the EF will silently generate non-skipped rows for next year's holidays. Mitigation: add an admin dashboard warning when `public_holiday` doesn't have an entry within the upcoming generation window. Track separately.
- **Timezone edge case** — EF runs at 19:00 UTC = 3am AWST. The "today" Date used for the window is UTC midnight, which is 8am AWST. For a few hours each evening UTC (between 16:00 and 23:59 UTC = 0am-7am AWST next day), "today" UTC and "today" AWST differ by one day. This is fine because the EF generates 16 weeks forward — the day-of-window offset doesn't matter at that horizon. Documented but no fix needed.
- **Schedule changes mid-window** — Updates to `collection_schedule` propagate only via new rows, not existing ones. If urgent, ops uses SQL UPDATE. Documented above.
- **EF cold start latency** — first invocation each day may be slow. The cron's pg_cron HTTP call has no retry. If a cold start times out, the cron won't re-trigger until next day. Mitigation: 16-week horizon means even a missed day is fine (next day's run catches up).

## Open follow-ups

- Build admin UI for managing `collection_schedule` and `public_holiday` entries (replaces SQL maintenance).
- Add an admin dashboard widget: "Upcoming holidays in window: 0 — re-seed required" warning.
- Auto-reschedule design (one-off vs same-week-shift, pool members coordinated).
- Add KWN schedule entries when ready (currently VV-only).
