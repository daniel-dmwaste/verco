# Verge Valet — Eligible Properties Import

**Date:** 2026-05-11
**Status:** Design approved
**Scope:** Stand up the WMRC tenant in Verco (client + 9 sub-clients + 11 collection areas) and import ~89k eligible properties from three Airtable bases. Allocation rules, service rules, collection dates, and branding fields are deferred to client onboarding via the admin UI.

---

## Context

Verge Valet (VV) is the on-demand verge collection service run by WMRC (Western Metropolitan Regional Council) on behalf of nine member councils. Resident-eligibility data — ~89k ratepayer addresses across the nine councils — currently lives in three Airtable bases:

| Base | ID | Rows | Councils covered |
|---|---|---|---|
| Verge Valet Bookings (Main) | `appWSysd50QoVaaRD` | 68,113 | COT, VIN, CAM, FRE, SOP, MOS, PEP (7) |
| Verge Valet Bookings (SUB) | `appuf7kTSNFXi7Rp0` | 6,571 | SUB (1) |
| Verge Valet Bookings (VIC) | `appIgPfNX8SYS9QIq` | 14,358 | VIC (1) |

The SUB and VIC bases are structural clones of the Main template (identical table and field IDs), differing only in their data and **absence of Latitude/Longitude fields**. Verco currently has zero WMRC scaffolding — no client row, sub-clients, collection areas, or properties — so this work both creates the tenant and loads its address data.

The KWN tenant (`scripts/import-kwn-properties.ts`, VER-177) is the closest precedent. This design extends that pattern with idempotency, multi-source ETL, and paid geocoding for the un-geocoded councils.

## Goals

- Stand up WMRC as a fully scaffolded Verco tenant: client → 9 sub-clients → 11 collection areas.
- Load ~89k eligible properties from three Airtable bases, correctly mapped to collection areas.
- Geocode the ~21k SUB+VIC properties using Google's Geocoding API (~$105 USD).
- Make the import idempotent and re-runnable so future ratepayer-roll updates are cheap.
- Clean Airtable data anomalies (orphan Council_Code rows, duplicate addresses) before import.

## Non-goals

- **Allocation rules, service rules, collection dates, branding fields, custom domain** — deferred to onboarding via the existing client-config admin UI (VER-177).
- **Ongoing scheduled sync** — re-imports are manual until volume of changes justifies automation.
- **Address validation / quality verdict** — we trust existing ratepayer-roll data; Geocoding API used purely for lat/long, not validation.
- **DM-Ops sync per LGA** — all 11 collection areas share `dm_job_code = 'VV'`; per-LGA reporting in DM-Ops is a separate piece of work.

## Entity layout

One `client` row, nine `sub_client` rows, eleven `collection_area` rows.

| Sub-client `code` / name | Area `code`s | Address source |
|---|---|---|
| `COT` Town of Cottesloe | `COT` | Main base |
| `VIN` City of Vincent | `VIN` (collapsed from the legacy VIN-B/VIN-G split) | Main base |
| `CAM` Town of Cambridge | `CAM-A`, `CAM-B` | Main base |
| `FRE` City of Fremantle | `FRE-N`, `FRE-S` | Main base |
| `SOP` City of South Perth | `SOP` | Main base |
| `MOS` Town of Mosman Park | `MOS` | Main base |
| `PEP` Shire of Peppermint Grove | `PEP` | Main base |
| `SUB` City of Subiaco | `SUB` | SUB base |
| `VIC` Town of Victoria Park | `VIC` | VIC base |

**Client config:**
- `name = 'Verge Valet'`
- `slug = 'vergevalet'` → dev URL `vergevalet.verco.au` (production via `custom_domain`)
- `primary_colour = '#293F52'` (default; brand colours set during onboarding)
- `service_name = 'Verge Valet'`
- `dm_job_code = 'VV'` on all 11 areas

Per `docs/VERCO_V2_TECH_SPEC.md`, `dm_job_code` is non-structural — it exists only for the `nightly-sync-to-dm-ops` Edge Function. All VV areas sharing one DM-Ops job code matches the current DM-Ops setup (single `VV` job).

## Architecture

Three artifacts, executed in sequence:

```
┌─ 1. Migration ──────────────────────────────────────────────────────┐
│  supabase/migrations/<timestamp>_wmrc_scaffolding_and_external_keys.sql │
│                                                                       │
│  a) ALTER TABLE eligible_properties                                   │
│       ADD COLUMN external_source text,                                │
│       ADD COLUMN external_id    text;                                 │
│     CREATE UNIQUE INDEX idx_eligible_properties_external              │
│       ON eligible_properties (external_source, external_id)           │
│       WHERE external_source IS NOT NULL;  -- partial: KWN stays null  │
│                                                                       │
│  b) INSERT client → 9 sub_clients → 11 collection_areas              │
│     (DO block with ON CONFLICT DO NOTHING; idempotent)               │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 2. Airtable hygiene script ───────────────────────────────────────┐
│  scripts/airtable-vv-hygiene.ts [--apply] [--base=<...>]            │
│                                                                       │
│  Reports + (with --apply) deletes orphan Council_Code rows.          │
│  Pre-flight check: every Airtable Council_Code maps to a Verco area. │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 3. Property import script ─────────────────────────────────────────┐
│  scripts/import-vv-properties.ts [--dry-run] [--source=<...>] [...] │
│                                                                       │
│  For each base: fetch → skip-if-existing → geocode (SUB/VIC only)   │
│   → transform → upsert by (external_source, external_id).            │
│                                                                       │
│  external_source = 'airtable:<baseId>'                                │
│  external_id     = Airtable record ID (rec...)                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Why three artifacts

| Concern | Rationale |
|---|---|
| Migration in PR review | Schema + structural data must be reviewable in version control. |
| Hygiene before load | Dirty data is easier to fix in Airtable than in Verco. |
| Re-runnability | Each artifact is independently idempotent. |
| Future re-syncs | Just re-run #3; `external_id` upsert is safe. |

### Run order (go-live)

1. PR with migration → review → merge → `pnpm supabase db push`
2. `npx tsx scripts/airtable-vv-hygiene.ts` — share report with Dan
3. `npx tsx scripts/airtable-vv-hygiene.ts --apply` (if approved)
4. `npx tsx scripts/import-vv-properties.ts --dry-run` — verify counts
5. `npx tsx scripts/import-vv-properties.ts` — full load (~11 min)
6. Run the verification SQL queries printed at end-of-run

---

## Migration detail

**File:** `supabase/migrations/<timestamp>_wmrc_scaffolding_and_external_keys.sql`

### Part A — Schema change

```sql
ALTER TABLE eligible_properties
  ADD COLUMN external_source text,
  ADD COLUMN external_id     text;

CREATE UNIQUE INDEX idx_eligible_properties_external
  ON eligible_properties (external_source, external_id)
  WHERE external_source IS NOT NULL;

COMMENT ON COLUMN eligible_properties.external_source IS
  'Source system identifier for imported rows. Format: <system>:<scope_id>.';
COMMENT ON COLUMN eligible_properties.external_id IS
  'Stable identifier in the source system. Used for idempotent re-imports.';
```

Partial unique index: existing KWN rows have `external_source IS NULL` and don't conflict. Only Airtable-imported rows enforce uniqueness on `(external_source, external_id)`.

### Part B — Tenant scaffolding (DO block)

```sql
DO $$
DECLARE
  v_contractor_id uuid;
  v_client_id     uuid;
  v_sc_cot uuid; v_sc_vin uuid; v_sc_cam uuid; v_sc_fre uuid;
  v_sc_sop uuid; v_sc_mos uuid; v_sc_pep uuid; v_sc_sub uuid; v_sc_vic uuid;
BEGIN
  SELECT id INTO v_contractor_id FROM contractor WHERE slug = 'dm';

  INSERT INTO client (contractor_id, name, slug, is_active, primary_colour, service_name, show_powered_by)
  VALUES (v_contractor_id, 'Verge Valet', 'vergevalet', true, '#293F52', 'Verge Valet', true)
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_client_id FROM client WHERE slug = 'vergevalet';

  INSERT INTO sub_client (client_id, code, name, is_active) VALUES
    (v_client_id, 'COT', 'Town of Cottesloe',         true),
    (v_client_id, 'VIN', 'City of Vincent',           true),
    (v_client_id, 'CAM', 'Town of Cambridge',         true),
    (v_client_id, 'FRE', 'City of Fremantle',         true),
    (v_client_id, 'SOP', 'City of South Perth',       true),
    (v_client_id, 'MOS', 'Town of Mosman Park',       true),
    (v_client_id, 'PEP', 'Shire of Peppermint Grove', true),
    (v_client_id, 'SUB', 'City of Subiaco',           true),
    (v_client_id, 'VIC', 'Town of Victoria Park',     true)
  ON CONFLICT (client_id, code) DO NOTHING;

  SELECT id INTO v_sc_cot FROM sub_client WHERE client_id = v_client_id AND code = 'COT';
  SELECT id INTO v_sc_vin FROM sub_client WHERE client_id = v_client_id AND code = 'VIN';
  SELECT id INTO v_sc_cam FROM sub_client WHERE client_id = v_client_id AND code = 'CAM';
  SELECT id INTO v_sc_fre FROM sub_client WHERE client_id = v_client_id AND code = 'FRE';
  SELECT id INTO v_sc_sop FROM sub_client WHERE client_id = v_client_id AND code = 'SOP';
  SELECT id INTO v_sc_mos FROM sub_client WHERE client_id = v_client_id AND code = 'MOS';
  SELECT id INTO v_sc_pep FROM sub_client WHERE client_id = v_client_id AND code = 'PEP';
  SELECT id INTO v_sc_sub FROM sub_client WHERE client_id = v_client_id AND code = 'SUB';
  SELECT id INTO v_sc_vic FROM sub_client WHERE client_id = v_client_id AND code = 'VIC';

  INSERT INTO collection_area (client_id, contractor_id, sub_client_id, name, code, dm_job_code, is_active) VALUES
    (v_client_id, v_contractor_id, v_sc_cot, 'Cottesloe',          'COT',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_vin, 'Vincent',            'VIN',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_cam, 'Cambridge — Area A', 'CAM-A', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_cam, 'Cambridge — Area B', 'CAM-B', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_fre, 'Fremantle — North',  'FRE-N', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_fre, 'Fremantle — South',  'FRE-S', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_sop, 'South Perth',        'SOP',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_mos, 'Mosman Park',        'MOS',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_pep, 'Peppermint Grove',   'PEP',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_sub, 'Subiaco',            'SUB',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_vic, 'Victoria Park',      'VIC',   'VV', true)
  ON CONFLICT (client_id, code) DO NOTHING;
END $$;
```

No `allocation_rules`, `service_rules`, or `collection_date` inserts — deferred to onboarding.

---

## Import script detail

**File:** `scripts/import-vv-properties.ts` + helpers in `scripts/lib/`

### File layout

```
scripts/
├── import-vv-properties.ts          ~150 lines, linear main flow
└── lib/
    ├── airtable-vv.ts               paginated fetch, record parsing
    ├── geocode.ts                   Google Geocoding API client + retry
    ├── transform.ts                 pure: Airtable row → Verco shape
    └── verco-upsert.ts              batched upsert by external key

scripts/__tests__/
├── normalise.test.ts                normaliseAddress() unit tests
├── transform.test.ts                toVercoRow() unit tests
└── geocode.test.ts                  Geocoding client tests (mocked fetch)
```

### Main flow

```
For each of the 3 Airtable bases:
  1. Fetch all Eligible Properties + Council_Code links (paginated, 1000/page).
  2. Query Verco for existing external_ids where external_source = 'airtable:<baseId>'.
  3. Filter Airtable rows into NEW vs EXISTING.
  4. For NEW rows in SUB/VIC: call Google Geocoding API (50 QPS, retry-on-429).
     For NEW rows in Main base: lat/lng already present, skip geocoding.
     For EXISTING rows: skip entirely.
  5. Transform NEW rows → Verco eligible_properties shape.
  6. Resolve Council_Code name → collection_area_id (looked up once at startup).
  7. Upsert in batches of 500 with ON CONFLICT (external_source, external_id) DO UPDATE.
  8. Log failed geocodes + skipped rows to import-report-<timestamp>.json.
At end: print verification SQL queries to stdout.
```

The pre-filter step (#2–#3) makes re-runs free for unchanged rows — no Google calls, no Verco writes. This is the practical payoff for the `external_id` column.

### Transformation (pure function)

```typescript
function toVercoRow(
  airtable: AirtableRecord,           // .latitude/.longitude exist only on Main base rows
  baseId: string,
  areaId: string,
  geocode: GeocodeResult | null,      // null for Main rows (already geocoded) and for soft failures
): EligiblePropertyInsert {
  const hasGeocode = !!(geocode?.lat && geocode?.lng) ||
                     !!(airtable.latitude && airtable.longitude);
  return {
    collection_area_id: areaId,
    address:            airtable.Address.trim(),
    formatted_address:  geocode?.formattedAddress ?? airtable.Address.trim(),
    latitude:           geocode?.lat ?? airtable.latitude  ?? null,
    longitude:          geocode?.lng ?? airtable.longitude ?? null,
    google_place_id:    geocode?.placeId ?? null,
    has_geocode:        hasGeocode,
    is_mud:             false,
    external_source:    `airtable:${baseId}`,
    external_id:        airtable.id,
  };
}
```

### CLI flags

| Flag | Purpose |
|---|---|
| `--dry-run` | Fetch + transform + report counts. No Google calls, no Verco writes. |
| `--source=<main\|sub\|vic\|all>` | Limit to one base. Default `all`. |
| `--limit=<n>` | First N rows per base — smoke-test before full run. |
| `--skip-geocode` | Force geocoding off. |

### Failure handling

| Failure | Behaviour |
|---|---|
| Airtable 429 | Exponential backoff, retry up to 5×. |
| Airtable 5xx | Retry 3×, then abort with clear error. |
| Google 429 / quota | Backoff + retry; if persistent, log row to report, continue with null lat/lng. |
| Google `ZERO_RESULTS` / partial match | Log to report, insert row with `has_geocode = false`. |
| Verco upsert error (batch) | Log batch, retry once with `onConflict` ignore, then fail. |
| Unknown Council_Code in Airtable | **Hard abort** — means area map is wrong. Must be fixed before continuing. |

### Environment variables

```
AIRTABLE_TOKEN=pat...                     # PAT with read on all 3 bases
GOOGLE_GEOCODING_API_KEY=AIza...          # Server-side key, restricted to Geocoding API
NEXT_PUBLIC_SUPABASE_URL=https://tfddjmplcizfirxqhotv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Performance budget

| Phase | Estimate |
|---|---|
| Fetch all 3 bases | ~30 sec |
| Pre-filter existing | ~5 sec |
| Geocode 21k SUB+VIC (50 QPS) | ~7 min |
| Upsert 89k @ 500/batch | ~3 min |
| **First run total** | **~11 min** |
| Re-run with no new rows | **~30 sec** |

---

## Airtable hygiene script detail

**File:** `scripts/airtable-vv-hygiene.ts` (~250 lines)

Conservative by design: only auto-deletes orphan Council_Code rows in `--apply` mode. Everything else is flagged for human review.

### Checks performed

| # | Check | `--apply` action |
|---|---|---|
| 1 | Orphan Council_Code rows (zero linked addresses) | DELETE |
| 2 | Orphan Eligible Properties (no Council_Code link) | Report only |
| 3 | Council_Codes that don't map to a Verco `collection_area.code` | Report + **non-zero exit** |
| 4 | Empty / one-char addresses | Report only |
| 5 | Within-base address duplicates (same normalised address + Council_Code) | Report only |
| 6 | Cross-base address duplicates | Report only |
| 7 | Suspiciously similar addresses (Levenshtein ≤ 2, same Council_Code) | Report only |

### Address normalisation (pure function)

```typescript
function normaliseAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(wa|western australia)\b\s*\d{4}?/gi, '') // strip state + postcode
    .replace(/,/g, ' ')                                    // commas → spaces
    .replace(/\s+/g, ' ')                                  // collapse whitespace
    .trim();
}
```

Aggressive enough to catch `"290 Carrington St Hilton"` vs `"290 Carrington ST HILTON WA 6163"` as the same address. Unit numbers (e.g. `21/94`) are preserved.

### Output

JSON report saved to `airtable-vv-hygiene-report-<YYYYMMDD-HHMMSS>.json` for diffing across runs. Schema includes per-finding record IDs, base IDs, and a summary block. Human summary printed to stdout.

### CLI flags

| Flag | Purpose |
|---|---|
| `--apply` | Delete orphan Council_Code rows (default: report only) |
| `--base=<main\|sub\|vic\|all>` | Limit scan to one base |
| `--output=<path>` | Override report path |

---

## Testing strategy

Proportionate to a one-shot ETL: minimal unit tests on pure logic, heavy reliance on `--dry-run` for verification.

| Layer | What | Where |
|---|---|---|
| Unit | `normaliseAddress()` correctness | `scripts/__tests__/normalise.test.ts` |
| Unit | `toVercoRow()` shape + geocode fallback | `scripts/__tests__/transform.test.ts` |
| Unit | Geocode response parser (`OK` / `ZERO_RESULTS` / `OVER_QUERY_LIMIT`) | `scripts/__tests__/geocode.test.ts` (mocked `fetch`) |
| Smoke | `--dry-run --limit=50` against real Airtable + Verco | Manual, during PR review |
| Smoke | Hygiene `--dry-run` finds known `"4c "` orphan | Manual |
| E2E | Full import against staging (if available); otherwise prod with `--dry-run` first | Manual |

No Playwright. This is a CLI, not a user-facing flow.

## Pre-flight checklist (go-live runbook)

```
□ Migration committed and merged
□ Migration applied:    pnpm supabase db push
□ Verify scaffolding:   SELECT count(*) FROM collection_area
                          WHERE client_id = (SELECT id FROM client WHERE slug='vergevalet');
                        -- expect 11
□ .env.local populated: AIRTABLE_TOKEN, GOOGLE_GEOCODING_API_KEY,
                        NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
□ Google Cloud billing enabled; quota ≥ 25k requests/day
□ Hygiene dry-run clean (or findings actioned):
    npx tsx scripts/airtable-vv-hygiene.ts
□ Hygiene applied (if approved):
    npx tsx scripts/airtable-vv-hygiene.ts --apply
□ Import dry-run:
    npx tsx scripts/import-vv-properties.ts --dry-run
□ Import live:
    npx tsx scripts/import-vv-properties.ts
□ Post-import verification (see below)
```

## Post-import verification

The script prints these queries at end-of-run:

```sql
-- 1. Row counts per area
SELECT ca.code, count(*)
  FROM eligible_properties ep
  JOIN collection_area ca ON ca.id = ep.collection_area_id
  JOIN client c ON c.id = ca.client_id
  WHERE c.slug = 'vergevalet'
  GROUP BY ca.code ORDER BY ca.code;

-- 2. Geocode coverage by source
SELECT external_source,
       count(*) total,
       count(*) FILTER (WHERE has_geocode) geocoded,
       round(100.0 * count(*) FILTER (WHERE has_geocode) / count(*), 1) pct
  FROM eligible_properties
  WHERE external_source LIKE 'airtable:%'
  GROUP BY external_source;

-- 3. Spot-check a known address
SELECT * FROM eligible_properties
  WHERE address ILIKE '%marine parade%cottesloe%' LIMIT 5;
```

Plus a manual `/book` smoke at `vergevalet.verco.au`: start typing a real VIC address and confirm autocomplete resolves it to the `VIC` collection area. Do not submit a booking (no rules configured yet).

## Rollback plan

| Scenario | Action |
|---|---|
| Migration breaks (DDL error) | Standard Supabase rollback. UUIDs not yet referenced elsewhere, safe to drop. |
| Migration succeeded but inserts wrong data | `DELETE FROM collection_area WHERE client_id = (SELECT id FROM client WHERE slug='vergevalet');` then `sub_client`, then `client`. Re-run migration. |
| Import imported wrong data (no bookings yet) | `DELETE FROM eligible_properties WHERE external_source LIKE 'airtable:%';` Re-run script. |
| Import imported wrong data, **bookings already exist** | Do not delete. Identify mis-mapped rows by `external_id` and update `collection_area_id` in place. |
| Geocode budget exhausted mid-run | Top up Google quota, re-run. Existing rows skip geocoding via the pre-filter. |

The point of no return is residents booking against imported properties. Go-live order: import → verify → only then enable VV booking in the admin UI.

## Open questions

None blocking. Two items deferred to onboarding:

1. **Allocation and service rules** for each of the 11 areas. Per-LGA bulk/green/mattress allocations live in the Airtable Council Code table today; Dan will set these via the admin UI when WMRC is onboarded.
2. **Custom domain** for `vergevalet` client. Dev URL is `vergevalet.verco.au`; production domain (e.g. `book.vergevalet.com.au` or similar) is a brand decision for onboarding.

## References

- `docs/VERCO_V2_TECH_SPEC.md` — `collection_area` schema, `dm_job_code` semantics, v2 migration mapping
- `docs/VERCO_V2_PRD.md` — entity hierarchy, white-label model
- `scripts/import-kwn-properties.ts` — precedent (VER-177)
- `supabase/seed.sql` — KWN tenant scaffolding pattern
- `docs/superpowers/specs/2026-04-16-client-config-design.md` — admin UI for rules + branding (onboarding)
