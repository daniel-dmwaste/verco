# Capacity Pool — Design Spec

**Date:** 2026-05-13
**Author:** Dan Taylor + Claude
**Status:** Approved (Dan delegated implementation 2026-05-13)
**Related work:** Follow-up to [#26](https://github.com/dmwaste/verco/pull/26) (VV allocation/service rules seed)

---

## Problem

Verge Valet's contract structure has one shared-crew arrangement that the current per-area capacity model can't represent:

- **Mosman Park (MOS)**, **Cottesloe (COT)**, and **Peppermint Grove (PEP)** share one crew, one truck, **60 stops/day**, on **Mon + Wed**.
- **Fremantle North (FRE-N)** runs **Mon only** and joins the MCP crew's Monday route.

The existing `collection_date` model is one-row-per-(area, date) with independent `bulk_capacity_limit` / `bulk_units_booked` counters. Modelling MCP today would require either:

1. Capping each MCP area at e.g. 20/day (loses pooling — bookings stuck even if other LGAs have slack).
2. Setting each at 60/day (over-books the crew — 180 bookings possible).
3. Manual operational throttling (defers the problem to D&M ops).

None of these are durable. We need a first-class abstraction for pooled capacity.

## Scope

- One pool: MCP (MOS + COT + PEP + FRE-N). No other pools today.
- Pure FCFS within the pool — no per-LGA reserves or quotas.
- The other 7 VV areas (CAM-A, CAM-B, FRE-S, SOP, SUB, VIC, VIN) and Kwinana stay on the per-area model unchanged.
- Booking attribution stays per-LGA (`booking.collection_area_id` unchanged) — per-LGA reporting/invoicing works without modification.

## Out of scope

- Day-of-week conditional pool membership (FRE-N's Monday-only is handled by collection_date generation skipping FRE-N on non-Mon dates — membership stays unconditional).
- Per-LGA soft reserves with overflow.
- Cross-contractor pools.
- Migrating Kwinana to the pool model (per-area is right for KWN).
- Daily date generation logic (already handled by the existing collection_date generator; we just hook into it for pool members).

## Approach (Option A — Explicit `capacity_pool`)

Three other approaches were considered (designated primary area via self-FK; trigger-based shadow updates; do nothing + UI throttle). Option A was chosen because:

- The pool IS a real abstraction — naming it makes the code read like operational reality.
- Per-area path (used by 9 of 11 VV areas + all of KWN) is untouched, eliminating regression risk.
- Generalizes if more pools emerge later.
- Trigger-based aggregation (Option C) drifts over time and needs periodic resync — known footgun.

## Architecture

### Schema

Three changes:

```sql
-- 1. New table: a named pool of collection areas sharing capacity.
CREATE TABLE capacity_pool (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES contractor(id) ON DELETE RESTRICT,
  code            text NOT NULL,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, code)
);

-- 2. Nullable membership pointer on collection_area.
ALTER TABLE collection_area
  ADD COLUMN capacity_pool_id uuid REFERENCES capacity_pool(id) ON DELETE SET NULL;

-- 3. Pool-level capacity counters per date.
CREATE TABLE collection_date_pool (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_pool_id      uuid NOT NULL REFERENCES capacity_pool(id) ON DELETE CASCADE,
  date                  date NOT NULL,
  bulk_capacity_limit   integer NOT NULL DEFAULT 0,
  bulk_units_booked     integer NOT NULL DEFAULT 0,
  bulk_is_closed        boolean NOT NULL DEFAULT false,
  anc_capacity_limit    integer NOT NULL DEFAULT 0,
  anc_units_booked      integer NOT NULL DEFAULT 0,
  anc_is_closed         boolean NOT NULL DEFAULT false,
  id_capacity_limit     integer NOT NULL DEFAULT 0,
  id_units_booked       integer NOT NULL DEFAULT 0,
  id_is_closed          boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capacity_pool_id, date)
);

CREATE INDEX collection_date_pool_pool_date_idx ON collection_date_pool(capacity_pool_id, date);
```

### Behaviour invariants

For any `collection_area`:

- **`capacity_pool_id IS NULL`** → existing per-area model. `collection_date.bulk_capacity_limit` is the authoritative cap; `bulk_units_booked` is the authoritative usage.
- **`capacity_pool_id IS NOT NULL`** → pooled model. `collection_date.bulk_capacity_limit` and `bulk_units_booked` are unused (kept at 0). Authoritative counters live on `collection_date_pool` keyed on `(capacity_pool_id, date)`.

The `collection_date` row for pooled areas continues to exist because `booking_item.collection_date_id` is an FK that points to it — needed for per-LGA reporting and invoicing.

## Data flow — `create_booking_with_capacity_check` RPC

Current logic (simplified):

```
1. Compute advisory lock key from collection_date_id
2. Sum requested units per category (bulk/anc/id)
3. SELECT (limit - booked) FROM collection_date WHERE id = p_collection_date_id
4. If any bucket short → RAISE EXCEPTION
5. Generate booking ref, insert booking + booking_items
```

New logic adds a pool branch BEFORE step 1:

```
0a. Look up collection_area.capacity_pool_id for p_collection_area_id
0b. If NULL → existing path (lock + check on collection_date)
0c. If NOT NULL → pooled path:
    - Find collection_date_pool row for (pool_id, date_of_p_collection_date_id)
    - Lock key = collection_date_pool.id prefix (NOT collection_date.id prefix)
    - SELECT (limit - booked) FROM collection_date_pool
    - If short → RAISE EXCEPTION
```

Booking insertion logic unchanged. `booking_item.collection_date_id` still points to the per-area `collection_date` row.

### Lock-key correctness

Critical: pool members must lock on the **shared** pool row, not the area row. Otherwise two concurrent bookings on MOS and COT for the same Monday could both pass capacity check before either commits. The advisory lock key derives from `collection_date_pool.id`, which is unique per `(pool, date)` — so all 4 MCP areas booking the same Monday acquire the same lock.

## Recalculation logic

`recalculate_collection_date_units` is the AFTER INSERT/UPDATE/DELETE trigger on `booking_item` that keeps `bulk_units_booked` accurate. Updated to be pool-aware:

```
1. Resolve collection_area_id from collection_date row
2. If collection_area.capacity_pool_id IS NULL:
     - Update collection_date counters (current behaviour)
3. Else:
     - Update collection_date_pool counters for (pool, date)
     - Leave collection_date counters at 0 (pooled areas don't use them)
4. Update is_closed flags on whichever row was touched
```

## Collection date generation

The collection_date generator (TBD by D&M ops — not yet automated; collection dates are manually inserted today) gets a parallel responsibility: for any pool member's collection_date row created, ensure a matching `collection_date_pool` row exists for `(pool, date)` with `bulk_capacity_limit = 60`. If the row already exists (because another pool member is also being seeded for that date), leave its limit unchanged — the first writer sets the cap.

Since the generator isn't built yet, this design just documents the contract. Today's seeding will create pool rows manually alongside collection_date rows.

## Migration steps

A single migration file does all of:

1. `CREATE TABLE capacity_pool` (with RLS — see below).
2. `ALTER TABLE collection_area ADD COLUMN capacity_pool_id` (nullable, no backfill — defaults to NULL = existing behaviour).
3. `CREATE TABLE collection_date_pool` (with RLS).
4. Replace `create_booking_with_capacity_check` with the pool-aware version.
5. Replace `recalculate_collection_date_units` with the pool-aware version.
6. Seed: `INSERT INTO capacity_pool (contractor_id, code, name) VALUES (<dmwm_id>, 'MCP', 'Mosman + Cottesloe + Peppermint Grove + Fremantle North')`.
7. `UPDATE collection_area SET capacity_pool_id = <mcp_id> WHERE code IN ('MOS', 'COT', 'PEP', 'FRE-N')`.

No data backfill needed for `collection_date_pool` rows — they'll be created as future collection dates are scheduled.

## RLS

- `capacity_pool` — public SELECT (like `collection_area`, since the booking flow exposes available dates via this table). Mutations restricted to `contractor-admin`/`contractor-staff` for own contractor.
- `collection_date_pool` — public SELECT (mirrors `collection_date`). Service-role-only writes (via the RPC + trigger).

## Testing strategy

- **Vitest unit tests** for the RPC logic — mock both pool members and non-pool members; verify lock keys differ.
- **Integration tests** using the real DB:
  - Two concurrent bookings on different MCP areas for the same Monday — exactly one should succeed if capacity = 1.
  - 60 bookings across MCP areas in one day — area #61 must fail regardless of which LGA it targets.
  - Booking on FRE-S (unpooled, same crew indirectly) — must not affect MCP pool counters.
  - Cancellation of a pooled booking — pool counter decrements; per-area counter stays at 0.
- **Idempotency check** on `recalculate_collection_date_units` for pooled areas — running it twice should not double-count.

## Implementation order

1. Create migration file with schema + RPC replacement + recalc replacement + seed.
2. Apply via Supabase MCP `apply_migration`.
3. Regenerate types (`pnpm supabase gen types typescript ...`).
4. Verify with SQL: query the MCP pool, members, and confirm RPC source has the pool branch.
5. Vitest tests for the pricing engine remain unchanged (this work doesn't touch pricing).
6. Add integration test for the pool capacity check — at least one happy + one failure case.
7. PR with the migration + updated types + tests.

## Risks

- **Drift between `collection_date` and `collection_date_pool` for pooled areas.** Mitigation: the recalc trigger is the single writer; if it correctly routes based on `capacity_pool_id`, drift can't occur. Belt-and-braces: a CHECK constraint that forbids non-zero counters on pooled-area `collection_date` rows could be added later if drift is observed.
- **Collection date generator isn't yet automated.** Until it is, pool rows must be created manually alongside collection_date rows. This is an operational quirk, not a design flaw. The generator (when built) takes over.
- **Future Ancillary support for VV** — the schema mirrors all three category buckets on `collection_date_pool` already, so no future migration needed when VV picks up Mattress as a paid extra. Today, anc/id columns will stay at 0/0/false for the MCP pool.

## Out-of-scope follow-ups

- **Per-LGA reporting view** that exposes "bookings per LGA per day" derived from `booking` joined to `collection_area`. The data is there; just no view yet.
- **Vincent's "max 90 General/wk" cap** — a weekly aggregate constraint, orthogonal to daily capacity. Separate design when needed.
- **Admin UI for managing pools** — adding/removing areas via `/admin/clients/[id]`. Out of scope for go-live; can be edited via SQL meanwhile.
