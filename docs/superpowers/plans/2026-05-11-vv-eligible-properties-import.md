# Verge Valet — Eligible Properties Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the WMRC tenant (1 client + 9 sub-clients + 11 collection areas) and import ~89k eligible properties from three Airtable bases into Verco Supabase, with idempotent re-runs and Google Geocoding for the un-geocoded SUB+VIC councils.

**Architecture:** One migration (DDL + scaffolding), two CLI scripts (hygiene + import), small pure-function `scripts/lib/` for testable units. The import script upserts by `(external_source, external_id)` using Airtable record IDs as the stable key, so re-runs skip already-imported rows and never re-pay for geocoding.

**Tech Stack:** TypeScript (strict), Vitest, Supabase JS client (service role), Airtable REST API, Google Geocoding API, pnpm, `tsx` to run scripts.

**Reference spec:** `docs/superpowers/specs/2026-05-11-vv-eligible-properties-import-design.md`

---

## File Structure

**New files:**

```
supabase/migrations/<timestamp>_wmrc_scaffolding_and_external_keys.sql
                                            DDL + tenant scaffolding (one atomic migration)

scripts/airtable-vv-hygiene.ts              CLI: scan Airtable for data anomalies
scripts/import-vv-properties.ts             CLI: import properties from 3 Airtable bases

scripts/lib/types.ts                        Shared TypeScript types
scripts/lib/normalise.ts                    normaliseAddress() — pure
scripts/lib/transform.ts                    toVercoRow() — pure
scripts/lib/geocode.ts                      Google Geocoding client + retry
scripts/lib/airtable-vv.ts                  Airtable fetch + pagination
scripts/lib/area-map.ts                     Council_Code → collection_area_id lookup
scripts/lib/verco-upsert.ts                 Batched upsert helpers
scripts/lib/cli.ts                          Shared flag parsing

scripts/__tests__/normalise.test.ts
scripts/__tests__/transform.test.ts
scripts/__tests__/geocode.test.ts
```

**Modified files:**

```
vitest.config.ts                            Add scripts/__tests__/ to include glob
.env.example                                Add AIRTABLE_TOKEN, GOOGLE_GEOCODING_API_KEY
```

---

## Task 1: Write the migration file

**Files:**
- Create: `supabase/migrations/<timestamp>_wmrc_scaffolding_and_external_keys.sql`

The `<timestamp>` should be in `YYYYMMDDHHMMSS` format. Generate via `pnpm supabase migration new wmrc_scaffolding_and_external_keys` (it creates the empty file with the correct timestamp).

- [ ] **Step 1: Create the migration file with the correct timestamp**

Run: `pnpm supabase migration new wmrc_scaffolding_and_external_keys`

Expected: Creates `supabase/migrations/<YYYYMMDDHHMMSS>_wmrc_scaffolding_and_external_keys.sql` (empty).

- [ ] **Step 2: Write the schema change + scaffolding into the file**

Write the entire migration body. Note both halves go in one file (the partial unique index makes the schema change idempotent against existing KWN rows):

```sql
-- ============================================================
-- WMRC tenant scaffolding + external-key columns
-- ============================================================
-- Two changes in one migration:
--
-- 1. Adds external_source + external_id columns to eligible_properties
--    with a partial UNIQUE index. Existing KWN rows keep these NULL and
--    are unaffected; future Airtable-sourced rows are uniquely keyed
--    on (source, id) for idempotent re-imports.
--
-- 2. Inserts the WMRC client, 9 sub-clients (one per LGA), and 11
--    collection areas (CAM and FRE each split into two). All inserts
--    are ON CONFLICT DO NOTHING so the migration is idempotent.
--
-- Allocation rules, service rules, collection dates, and branding fields
-- are NOT set here — they're deferred to the existing client-config admin
-- UI during onboarding.
-- ============================================================

-- Part A — schema change to eligible_properties
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


-- Part B — WMRC tenant scaffolding
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

- [ ] **Step 3: Lint the SQL by reading it back**

Read the file in full. Confirm: 9 sub-clients listed, 11 collection_areas listed (CAM-A, CAM-B and FRE-N, FRE-S are the splits). All have `dm_job_code = 'VV'`. ON CONFLICT clauses present on all three INSERTs.

- [ ] **Step 4: Commit the migration**

```bash
git add supabase/migrations/<filename>.sql
git commit -m "$(cat <<'EOF'
feat(db): WMRC tenant scaffolding + external-key columns

Creates the Verge Valet client (slug=vergevalet), 9 sub-clients
(one per LGA), and 11 collection areas (CAM and FRE each split).
Adds external_source + external_id columns to eligible_properties
with a partial UNIQUE index for idempotent Airtable re-imports.

Allocation rules, service rules, collection dates, and branding are
deferred to client onboarding via the admin UI.
EOF
)"
```

The migration is **not pushed to remote yet** — that's Task 17. We want PR review before applying.

---

## Task 2: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Read the current .env.example**

Run: `cat .env.example`

Note the existing variable patterns and grouping.

- [ ] **Step 2: Append new variables**

Add the following block at the end of `.env.example`:

```bash
# ── Scripts: scripts/import-vv-properties.ts + scripts/airtable-vv-hygiene.ts ──
# Airtable personal access token with read on the three Verge Valet bases:
#   - appWSysd50QoVaaRD (Main)
#   - appuf7kTSNFXi7Rp0 (SUB)
#   - appIgPfNX8SYS9QIq (VIC)
AIRTABLE_TOKEN=

# Google Geocoding API key (server-side, restricted to Geocoding API).
# Used only by the import script to geocode SUB + VIC addresses
# (~21k lookups, ~$105 USD per first run; near-zero on re-runs).
GOOGLE_GEOCODING_API_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(env): document AIRTABLE_TOKEN + GOOGLE_GEOCODING_API_KEY for VV import"
```

---

## Task 3: Extend Vitest config to include scripts tests

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Read current config**

Run: `cat vitest.config.ts`

- [ ] **Step 2: Update the `include` glob**

Replace:

```typescript
include: ['src/__tests__/**/*.test.{ts,tsx}'],
```

With:

```typescript
include: ['src/__tests__/**/*.test.{ts,tsx}', 'scripts/__tests__/**/*.test.ts'],
```

- [ ] **Step 3: Verify Vitest still runs (no tests to add yet, just check the config parses)**

Run: `pnpm test --run`

Expected: All existing tests pass (no scripts tests yet, so the new glob matches nothing).

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "test(config): include scripts/__tests__/ in Vitest runs"
```

---

## Task 4: Define shared types

**Files:**
- Create: `scripts/lib/types.ts`

These types are referenced by every other lib file. Define them up front.

- [ ] **Step 1: Create the file with all shared types**

```typescript
// scripts/lib/types.ts
// Shared types for the VV import + hygiene scripts.

/** Airtable record ID (e.g. "rec00ANo7vIwiCTTo"). */
export type AirtableRecordId = string

/** Verco eligible_properties row ID. */
export type EligiblePropertyId = string

/**
 * One Verge Valet base in Airtable. The three are structural clones
 * (same table + field IDs) so they share field-ID constants but live
 * at different baseIds with different data.
 */
export type VvBase = {
  key: 'main' | 'sub' | 'vic'
  baseId: string
  /** Whether this base's Eligible Properties rows have lat/long fields. */
  hasGeocode: boolean
}

export const VV_BASES: readonly VvBase[] = [
  { key: 'main', baseId: 'appWSysd50QoVaaRD', hasGeocode: true  },
  { key: 'sub',  baseId: 'appuf7kTSNFXi7Rp0', hasGeocode: false },
  { key: 'vic',  baseId: 'appIgPfNX8SYS9QIq', hasGeocode: false },
] as const

/** Airtable record IDs are stable per-base. The (baseId, recordId) pair is globally unique. */
export type AirtableEligibleProperty = {
  id: AirtableRecordId
  address: string
  /** Council_Code linked-record name (the council code, e.g. "FRE-S"). One value expected. */
  councilCode: string | null
  /** Only present on the Main base. Null on SUB + VIC. */
  latitude: number | null
  longitude: number | null
}

/** Single result row from the Google Geocoding API. */
export type GeocodeResult = {
  lat: number
  lng: number
  placeId: string
  formattedAddress: string
}

/** Verco eligible_properties INSERT shape (matches the table columns after migration). */
export type EligiblePropertyInsert = {
  collection_area_id: string
  address: string
  formatted_address: string | null
  latitude: number | null
  longitude: number | null
  google_place_id: string | null
  has_geocode: boolean
  is_mud: boolean
  external_source: string
  external_id: string
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/lib/types.ts
git commit -m "feat(scripts/lib): shared types for VV import"
```

---

## Task 5: Implement `normaliseAddress()` (TDD)

**Files:**
- Create: `scripts/__tests__/normalise.test.ts`
- Create: `scripts/lib/normalise.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/__tests__/normalise.test.ts
import { describe, it, expect } from 'vitest'
import { normaliseAddress } from '../lib/normalise'

describe('normaliseAddress', () => {
  it('lowercases the address', () => {
    expect(normaliseAddress('290 Carrington ST HILTON')).toBe('290 carrington st hilton')
  })

  it('strips trailing state + postcode', () => {
    expect(normaliseAddress('290 Carrington St Hilton WA 6163')).toBe('290 carrington st hilton')
  })

  it('strips "Western Australia" + postcode', () => {
    expect(normaliseAddress('14 Smith Rd Subiaco Western Australia 6008')).toBe('14 smith rd subiaco')
  })

  it('collapses multiple whitespace to single space', () => {
    expect(normaliseAddress('  290  Carrington   ST   HILTON  ')).toBe('290 carrington st hilton')
  })

  it('replaces commas with spaces then collapses', () => {
    expect(normaliseAddress('21/94 Marine Parade, COTTESLOE, WA 6011')).toBe('21/94 marine parade cottesloe')
  })

  it('preserves unit numbers separated by slash', () => {
    expect(normaliseAddress('21/94 Marine Parade')).toBe('21/94 marine parade')
  })

  it('returns empty string for empty input', () => {
    expect(normaliseAddress('')).toBe('')
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm test scripts/__tests__/normalise.test.ts`

Expected: FAIL with "Failed to load url" or "Cannot find module '../lib/normalise'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// scripts/lib/normalise.ts
/**
 * Normalise an address for duplicate detection.
 *
 * Aggressive enough to catch "290 Carrington St Hilton WA 6163" and
 * "290 Carrington ST HILTON" as the same address. Unit numbers
 * (e.g. "21/94") are preserved.
 *
 * NOT for display — only for dedup keys.
 */
export function normaliseAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(wa|western australia)\b\s*\d{4}?/gi, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm test scripts/__tests__/normalise.test.ts`

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/__tests__/normalise.test.ts scripts/lib/normalise.ts
git commit -m "feat(scripts/lib): normaliseAddress() for dedup detection"
```

---

## Task 6: Implement `toVercoRow()` (TDD)

**Files:**
- Create: `scripts/__tests__/transform.test.ts`
- Create: `scripts/lib/transform.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/__tests__/transform.test.ts
import { describe, it, expect } from 'vitest'
import { toVercoRow } from '../lib/transform'
import type { AirtableEligibleProperty, GeocodeResult } from '../lib/types'

const baseId = 'appTESTbase00000000'
const areaId = '00000000-0000-0000-0000-000000000001'

const mainRow: AirtableEligibleProperty = {
  id: 'rec00ANo7vIwiCTTo',
  address: '290 Carrington ST HILTON',
  councilCode: 'FRE-S',
  latitude: -32.0737559,
  longitude: 115.7801567,
}

const subRow: AirtableEligibleProperty = {
  id: 'rec00DIxQ0T4acSe1',
  address: '8/112 Hensman Road SUBIACO',
  councilCode: 'SUB',
  latitude: null,
  longitude: null,
}

const fakeGeocode: GeocodeResult = {
  lat: -31.9421,
  lng: 115.8267,
  placeId: 'ChIJ_test_place_id',
  formattedAddress: '8/112 Hensman Rd, Subiaco WA 6008, Australia',
}

describe('toVercoRow', () => {
  it('uses Airtable lat/lng when geocode is null (Main base case)', () => {
    const row = toVercoRow(mainRow, baseId, areaId, null)
    expect(row).toEqual({
      collection_area_id: areaId,
      address: '290 Carrington ST HILTON',
      formatted_address: '290 Carrington ST HILTON',
      latitude: -32.0737559,
      longitude: 115.7801567,
      google_place_id: null,
      has_geocode: true,
      is_mud: false,
      external_source: `airtable:${baseId}`,
      external_id: 'rec00ANo7vIwiCTTo',
    })
  })

  it('uses geocode lat/lng + formatted_address + place_id when provided (SUB/VIC case)', () => {
    const row = toVercoRow(subRow, baseId, areaId, fakeGeocode)
    expect(row.latitude).toBe(-31.9421)
    expect(row.longitude).toBe(115.8267)
    expect(row.google_place_id).toBe('ChIJ_test_place_id')
    expect(row.formatted_address).toBe('8/112 Hensman Rd, Subiaco WA 6008, Australia')
    expect(row.has_geocode).toBe(true)
  })

  it('has_geocode is false when neither geocode nor Airtable coords present', () => {
    const row = toVercoRow(subRow, baseId, areaId, null)
    expect(row.has_geocode).toBe(false)
    expect(row.latitude).toBeNull()
    expect(row.longitude).toBeNull()
    expect(row.google_place_id).toBeNull()
  })

  it('trims whitespace from address', () => {
    const messy = { ...mainRow, address: '  290 Carrington ST HILTON  ' }
    const row = toVercoRow(messy, baseId, areaId, null)
    expect(row.address).toBe('290 Carrington ST HILTON')
  })

  it('falls back to address when formatted_address from geocode is missing', () => {
    const row = toVercoRow(subRow, baseId, areaId, null)
    expect(row.formatted_address).toBe('8/112 Hensman Road SUBIACO')
  })

  it('always sets is_mud to false', () => {
    expect(toVercoRow(mainRow, baseId, areaId, null).is_mud).toBe(false)
    expect(toVercoRow(subRow, baseId, areaId, fakeGeocode).is_mud).toBe(false)
  })

  it('encodes external_source as airtable:<baseId>', () => {
    expect(toVercoRow(mainRow, baseId, areaId, null).external_source).toBe(`airtable:${baseId}`)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm test scripts/__tests__/transform.test.ts`

Expected: FAIL with "Cannot find module '../lib/transform'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// scripts/lib/transform.ts
import type {
  AirtableEligibleProperty,
  EligiblePropertyInsert,
  GeocodeResult,
} from './types'

/**
 * Transform one Airtable row into a Verco eligible_properties INSERT.
 *
 * Pure function — no I/O. The caller is responsible for resolving the
 * Council_Code → areaId mapping and (for SUB/VIC) running the geocode
 * lookup before calling.
 *
 * Behaviour:
 *   • For Main-base rows, pass geocode=null and lat/lng come from Airtable.
 *   • For SUB/VIC rows that geocoded successfully, pass the GeocodeResult.
 *   • For SUB/VIC rows that failed to geocode, pass geocode=null — the row
 *     still gets inserted, but with null lat/lng and has_geocode=false.
 */
export function toVercoRow(
  airtable: AirtableEligibleProperty, // .latitude/.longitude exist only on Main base rows
  baseId: string,
  areaId: string,
  geocode: GeocodeResult | null,      // null for Main rows + for SUB/VIC soft-failures
): EligiblePropertyInsert {
  const address = airtable.address.trim()
  const lat = geocode?.lat ?? airtable.latitude ?? null
  const lng = geocode?.lng ?? airtable.longitude ?? null
  const hasGeocode = lat !== null && lng !== null

  return {
    collection_area_id: areaId,
    address,
    formatted_address: geocode?.formattedAddress ?? address,
    latitude: lat,
    longitude: lng,
    google_place_id: geocode?.placeId ?? null,
    has_geocode: hasGeocode,
    is_mud: false,
    external_source: `airtable:${baseId}`,
    external_id: airtable.id,
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm test scripts/__tests__/transform.test.ts`

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/__tests__/transform.test.ts scripts/lib/transform.ts
git commit -m "feat(scripts/lib): toVercoRow() — pure Airtable→Verco transform"
```

---

## Task 7: Implement Google Geocoding client (TDD)

**Files:**
- Create: `scripts/__tests__/geocode.test.ts`
- Create: `scripts/lib/geocode.ts`

The geocode client wraps a single REST call to the Google Geocoding API. Retry on 429 with exponential backoff. Soft-fail on `ZERO_RESULTS` (returns null).

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/__tests__/geocode.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { geocodeAddress } from '../lib/geocode'

const apiKey = 'fake-api-key'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function mockGoogleResponse(body: object, status = 200) {
  ;(global.fetch as any).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('geocodeAddress', () => {
  it('returns a GeocodeResult on a successful OK response', async () => {
    mockGoogleResponse({
      status: 'OK',
      results: [{
        geometry: { location: { lat: -31.9421, lng: 115.8267 } },
        place_id: 'ChIJ_subiaco',
        formatted_address: '8/112 Hensman Rd, Subiaco WA 6008, Australia',
      }],
    })

    const result = await geocodeAddress('8/112 Hensman Road SUBIACO', apiKey)

    expect(result).toEqual({
      lat: -31.9421,
      lng: 115.8267,
      placeId: 'ChIJ_subiaco',
      formattedAddress: '8/112 Hensman Rd, Subiaco WA 6008, Australia',
    })
  })

  it('returns null on ZERO_RESULTS', async () => {
    mockGoogleResponse({ status: 'ZERO_RESULTS', results: [] })
    expect(await geocodeAddress('totally fake address', apiKey)).toBeNull()
  })

  it('retries on OVER_QUERY_LIMIT and succeeds on second attempt', async () => {
    mockGoogleResponse({ status: 'OVER_QUERY_LIMIT', results: [] })
    mockGoogleResponse({
      status: 'OK',
      results: [{
        geometry: { location: { lat: 1, lng: 2 } },
        place_id: 'p',
        formatted_address: 'a',
      }],
    })

    const result = await geocodeAddress('addr', apiKey, { initialDelayMs: 1 })
    expect(result).not.toBeNull()
    expect(result?.lat).toBe(1)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns null after max retries on persistent OVER_QUERY_LIMIT', async () => {
    for (let i = 0; i < 5; i++) {
      mockGoogleResponse({ status: 'OVER_QUERY_LIMIT', results: [] })
    }
    const result = await geocodeAddress('addr', apiKey, { initialDelayMs: 1, maxRetries: 4 })
    expect(result).toBeNull()
  })

  it('throws on a network-level error (non-OK HTTP status)', async () => {
    mockGoogleResponse({}, 500)
    await expect(geocodeAddress('addr', apiKey, { initialDelayMs: 1, maxRetries: 0 }))
      .rejects.toThrow(/HTTP 500/)
  })

  it('URL-encodes the address in the query string', async () => {
    mockGoogleResponse({ status: 'ZERO_RESULTS', results: [] })
    await geocodeAddress('21/94 Marine Parade', apiKey)
    const url = (global.fetch as any).mock.calls[0][0] as string
    expect(url).toContain('address=21%2F94%20Marine%20Parade')
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm test scripts/__tests__/geocode.test.ts`

Expected: FAIL with "Cannot find module '../lib/geocode'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// scripts/lib/geocode.ts
import type { GeocodeResult } from './types'

type GeocodeOptions = {
  /** Initial backoff delay in milliseconds. Defaults to 200. */
  initialDelayMs?: number
  /** Max retries on OVER_QUERY_LIMIT. Defaults to 4. */
  maxRetries?: number
  /** AU region bias. Defaults to true. */
  biasAu?: boolean
}

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json'

/**
 * Call Google's Geocoding API for one address.
 *
 *   • Returns a GeocodeResult on OK with at least one result.
 *   • Returns null on ZERO_RESULTS (soft failure — caller continues).
 *   • Returns null after maxRetries+1 attempts on OVER_QUERY_LIMIT.
 *   • Throws on HTTP error (5xx, network failure, malformed response).
 *
 * Caller controls QPS via the surrounding loop; this function does not
 * rate-limit itself beyond per-call retry backoff.
 */
export async function geocodeAddress(
  address: string,
  apiKey: string,
  opts: GeocodeOptions = {},
): Promise<GeocodeResult | null> {
  const initialDelayMs = opts.initialDelayMs ?? 200
  const maxRetries = opts.maxRetries ?? 4
  const biasAu = opts.biasAu ?? true

  const params = new URLSearchParams({ address, key: apiKey })
  if (biasAu) params.set('region', 'au')
  const url = `${ENDPOINT}?${params.toString()}`

  let attempt = 0
  let delay = initialDelayMs
  while (true) {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Geocoding API HTTP ${res.status}`)
    }
    const body = (await res.json()) as {
      status: string
      results: Array<{
        geometry: { location: { lat: number; lng: number } }
        place_id: string
        formatted_address: string
      }>
    }

    if (body.status === 'OK' && body.results.length > 0) {
      const top = body.results[0]
      return {
        lat: top.geometry.location.lat,
        lng: top.geometry.location.lng,
        placeId: top.place_id,
        formattedAddress: top.formatted_address,
      }
    }
    if (body.status === 'ZERO_RESULTS') return null
    if (body.status === 'OVER_QUERY_LIMIT' && attempt < maxRetries) {
      await sleep(delay)
      attempt++
      delay *= 2
      continue
    }
    // Persistent OVER_QUERY_LIMIT, INVALID_REQUEST, REQUEST_DENIED, UNKNOWN_ERROR — soft fail
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm test scripts/__tests__/geocode.test.ts`

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/__tests__/geocode.test.ts scripts/lib/geocode.ts
git commit -m "feat(scripts/lib): geocodeAddress() with retry + soft-fail"
```

---

## Task 8: Implement Airtable client

**Files:**
- Create: `scripts/lib/airtable-vv.ts`

No tests for this one — it's a thin REST wrapper that's exercised end-to-end in the script smoke runs. The transformation it produces is covered by `toVercoRow` tests.

- [ ] **Step 1: Write the implementation**

```typescript
// scripts/lib/airtable-vv.ts
import type { AirtableEligibleProperty } from './types'

const ELIGIBLE_PROPERTIES_TABLE_ID = 'tbl5qHD1ZizpymXN9'
const COUNCIL_CODE_TABLE_ID = 'tbl99oRF44wTsY7ec'

const PAGE_SIZE = 100 // Airtable's max for the standard endpoint
const RETRY_BACKOFF_MS = 1000
const MAX_RETRIES = 5

type AirtableListResponse<TFields> = {
  records: Array<{ id: string; fields: TFields }>
  offset?: string
}

type EligibleFields = {
  Address?: string
  Council_Code?: Array<{ id: string; name: string }>
  Latitude?: number
  Longitude?: number
}

type CouncilCodeFields = {
  Council_ID?: string
}

/**
 * Fetch all Eligible Properties from one Verge Valet base.
 *
 * Returns a flat list with the council code resolved from the linked-record
 * name (Airtable returns the name in cellValuesByFieldId when fields are
 * referenced by name, but our linked-record returns just record IDs — so
 * we fetch the Council Code table once and build a lookup).
 */
export async function fetchAllEligibleProperties(
  baseId: string,
  token: string,
): Promise<AirtableEligibleProperty[]> {
  // 1. Build councilCodeId → councilCodeName lookup.
  const codeLookup = await fetchCouncilCodeLookup(baseId, token)

  // 2. Paginate through Eligible Properties.
  const results: AirtableEligibleProperty[] = []
  let offset: string | undefined = undefined
  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) })
    if (offset) params.set('offset', offset)
    const url = `https://api.airtable.com/v0/${baseId}/${ELIGIBLE_PROPERTIES_TABLE_ID}?${params}`
    const body = await airtableFetch<AirtableListResponse<EligibleFields>>(url, token)

    for (const rec of body.records) {
      const codeId = rec.fields.Council_Code?.[0]?.id
      const councilCode = codeId ? codeLookup.get(codeId) ?? null : null
      results.push({
        id: rec.id,
        address: rec.fields.Address ?? '',
        councilCode,
        latitude: rec.fields.Latitude ?? null,
        longitude: rec.fields.Longitude ?? null,
      })
    }
    offset = body.offset
  } while (offset)

  return results
}

/**
 * Fetch the Council Code lookup table for one base.
 * Returns Map<recordId, councilCodeName> (e.g. recXYZ → "FRE-S").
 */
export async function fetchCouncilCodeLookup(
  baseId: string,
  token: string,
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>()
  let offset: string | undefined = undefined
  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) })
    if (offset) params.set('offset', offset)
    const url = `https://api.airtable.com/v0/${baseId}/${COUNCIL_CODE_TABLE_ID}?${params}`
    const body = await airtableFetch<AirtableListResponse<CouncilCodeFields>>(url, token)
    for (const rec of body.records) {
      const id = rec.fields.Council_ID
      if (id) lookup.set(rec.id, id)
    }
    offset = body.offset
  } while (offset)
  return lookup
}

/** Delete one Airtable record (used by the hygiene script). */
export async function deleteAirtableRecord(
  baseId: string,
  tableId: string,
  recordId: string,
  token: string,
): Promise<void> {
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Airtable DELETE failed: HTTP ${res.status}`)
  }
}

async function airtableFetch<T>(url: string, token: string): Promise<T> {
  let attempt = 0
  while (true) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) return (await res.json()) as T
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt))
      attempt++
      continue
    }
    throw new Error(`Airtable HTTP ${res.status} for ${url}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export const AIRTABLE_TABLE_IDS = {
  ELIGIBLE_PROPERTIES: ELIGIBLE_PROPERTIES_TABLE_ID,
  COUNCIL_CODE: COUNCIL_CODE_TABLE_ID,
} as const
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit -p tsconfig.json`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/airtable-vv.ts
git commit -m "feat(scripts/lib): Airtable client for VV Eligible Properties + Council Code"
```

---

## Task 9: Implement area-map loader

**Files:**
- Create: `scripts/lib/area-map.ts`

At script startup, query Verco for all collection_area rows under the `vergevalet` client and build a `code → uuid` map. The transform call uses this to set `collection_area_id`.

- [ ] **Step 1: Write the implementation**

```typescript
// scripts/lib/area-map.ts
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Maps Airtable Council_Code (e.g. "FRE-S") to Verco collection_area.id.
 *
 * Vincent is collapsed: both legacy Airtable codes "VIN-B" and "VIN-G"
 * map to the single Verco area "VIN".
 */
export type AreaMap = Map<string, string>

const VINCENT_COLLAPSE: Record<string, string> = {
  'VIN-B': 'VIN',
  'VIN-G': 'VIN',
}

export async function loadAreaMap(verco: SupabaseClient): Promise<AreaMap> {
  const { data: client, error: clientErr } = await verco
    .from('client')
    .select('id')
    .eq('slug', 'vergevalet')
    .single()
  if (clientErr || !client) {
    throw new Error(`Could not find client with slug 'vergevalet'. Run the migration first. ${clientErr?.message ?? ''}`)
  }

  const { data: areas, error: areasErr } = await verco
    .from('collection_area')
    .select('id, code')
    .eq('client_id', client.id)
  if (areasErr) throw new Error(`Could not load collection_areas: ${areasErr.message}`)
  if (!areas || areas.length === 0) {
    throw new Error("vergevalet client has zero collection_areas. Run the migration first.")
  }

  const map: AreaMap = new Map()
  for (const a of areas) map.set(a.code, a.id)

  if (map.size !== 11) {
    throw new Error(`Expected 11 collection_areas for vergevalet, found ${map.size}. Codes: ${[...map.keys()].join(', ')}`)
  }
  return map
}

/**
 * Resolve a Council_Code from Airtable to a Verco area UUID.
 * Returns null if the code has no Verco mapping (caller treats as hard error).
 */
export function resolveAreaId(airtableCode: string, map: AreaMap): string | null {
  const collapsed = VINCENT_COLLAPSE[airtableCode] ?? airtableCode
  return map.get(collapsed) ?? null
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit -p tsconfig.json`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/area-map.ts
git commit -m "feat(scripts/lib): loadAreaMap() + resolveAreaId() with VIN-B/G collapse"
```

---

## Task 10: Implement batched upsert helper

**Files:**
- Create: `scripts/lib/verco-upsert.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// scripts/lib/verco-upsert.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EligiblePropertyInsert } from './types'

const BATCH_SIZE = 500

/**
 * Upsert eligible_properties rows in batches.
 *
 * Conflict target: (external_source, external_id), which is the partial
 * unique index added by the WMRC scaffolding migration. The DO UPDATE
 * branch is implicit via Supabase's upsert() with onConflict.
 *
 * Returns counts of inserted-or-updated rows + failed batches (for the
 * report file). On a failed batch, logs the error and continues.
 */
export async function upsertEligibleProperties(
  verco: SupabaseClient,
  rows: EligiblePropertyInsert[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failedBatches: number }> {
  let ok = 0
  let failedBatches = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await verco
      .from('eligible_properties')
      .upsert(batch, { onConflict: 'external_source,external_id' })
    if (error) {
      console.error(`Upsert batch ${i}–${i + batch.length} failed: ${error.message}`)
      failedBatches++
    } else {
      ok += batch.length
    }
    onProgress?.(Math.min(i + batch.length, rows.length), rows.length)
  }
  return { ok, failedBatches }
}

/**
 * Fetch all existing external_ids for a given source, used by the import
 * pre-filter so re-runs skip already-imported rows.
 */
export async function fetchExistingExternalIds(
  verco: SupabaseClient,
  externalSource: string,
): Promise<Set<string>> {
  const out = new Set<string>()
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await verco
      .from('eligible_properties')
      .select('external_id')
      .eq('external_source', externalSource)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`fetchExistingExternalIds: ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data) {
      if (r.external_id) out.add(r.external_id)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return out
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit -p tsconfig.json`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/verco-upsert.ts
git commit -m "feat(scripts/lib): batched upsert + existing-ID pre-filter"
```

---

## Task 11: Implement CLI flag helper

**Files:**
- Create: `scripts/lib/cli.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// scripts/lib/cli.ts
/**
 * Tiny argv parser for --flag=value and --flag styles.
 * Avoids adding a dependency for what's a handful of flags per script.
 */
export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq === -1) {
      out[arg.slice(2)] = true
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1)
    }
  }
  return out
}

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm tsc --noEmit -p tsconfig.json
git add scripts/lib/cli.ts
git commit -m "feat(scripts/lib): parseFlags + requireEnv"
```

---

## Task 12: Implement Airtable hygiene script

**Files:**
- Create: `scripts/airtable-vv-hygiene.ts`

- [ ] **Step 1: Write the script**

```typescript
// scripts/airtable-vv-hygiene.ts
/**
 * VV Airtable hygiene — scans the three Verge Valet bases for data
 * anomalies (orphans, empties, duplicates, unmapped codes) and writes
 * a JSON report. With --apply, deletes orphan Council_Code rows.
 *
 * Pre-flight check: every Airtable Council_Code must map to a Verco
 * collection_area. If any don't, the script exits non-zero so the import
 * cannot proceed against bad data.
 *
 * Usage:
 *   npx tsx scripts/airtable-vv-hygiene.ts                # dry-run, all bases
 *   npx tsx scripts/airtable-vv-hygiene.ts --apply        # delete orphans
 *   npx tsx scripts/airtable-vv-hygiene.ts --base=vic
 *   npx tsx scripts/airtable-vv-hygiene.ts --output=foo.json
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import {
  AIRTABLE_TABLE_IDS,
  deleteAirtableRecord,
  fetchAllEligibleProperties,
  fetchCouncilCodeLookup,
} from './lib/airtable-vv'
import { loadAreaMap, resolveAreaId } from './lib/area-map'
import { normaliseAddress } from './lib/normalise'
import { parseFlags, requireEnv } from './lib/cli'
import { VV_BASES, type VvBase } from './lib/types'

type Finding<T> = T & { baseId: string }
type Report = {
  scannedAt: string
  applied: boolean
  sources: Record<string, { baseId: string; rowsScanned: number }>
  findings: {
    orphan_council_codes: Finding<{ recordId: string; code: string }>[]
    orphan_addresses: Finding<{ recordId: string; address: string }>[]
    unmapped_council_codes: Finding<{ code: string; addressCount: number }>[]
    empty_addresses: Finding<{ recordId: string; address: string }>[]
    within_base_duplicates: Finding<{ council_code: string; normalised: string; records: string[] }>[]
    cross_base_duplicates: { normalised: string; entries: { baseId: string; recordId: string }[] }[]
  }
  summary: Record<string, number>
}

async function main() {
  const flags = parseFlags(process.argv)
  const apply = !!flags.apply
  const baseFilter = (flags.base as string | undefined) ?? 'all'
  const outputPath = (flags.output as string | undefined)
    ?? `airtable-vv-hygiene-report-${timestamp()}.json`

  const airtableToken = requireEnv('AIRTABLE_TOKEN')
  const supabaseUrl   = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey    = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const verco = createClient(supabaseUrl, serviceKey)

  // Pre-flight: load Verco area map.
  const areaMap = await loadAreaMap(verco)
  console.log(`Loaded ${areaMap.size} Verco collection_areas under vergevalet.`)

  const bases = baseFilter === 'all'
    ? VV_BASES
    : VV_BASES.filter((b) => b.key === baseFilter)
  if (bases.length === 0) {
    console.error(`Unknown base filter: ${baseFilter}. Use main, sub, vic, or all.`)
    process.exit(1)
  }

  const report: Report = {
    scannedAt: new Date().toISOString(),
    applied: apply,
    sources: {},
    findings: {
      orphan_council_codes: [],
      orphan_addresses: [],
      unmapped_council_codes: [],
      empty_addresses: [],
      within_base_duplicates: [],
      cross_base_duplicates: [],
    },
    summary: {},
  }

  const crossBaseSeen = new Map<string, { baseId: string; recordId: string }[]>()

  for (const base of bases) {
    await scanBase(base, airtableToken, areaMap, report, crossBaseSeen)
  }

  // Cross-base dupes — only entries with >1 base
  for (const [normalised, entries] of crossBaseSeen) {
    const bases = new Set(entries.map((e) => e.baseId))
    if (bases.size > 1) {
      report.findings.cross_base_duplicates.push({ normalised, entries })
    }
  }

  // Summary
  report.summary = {
    orphan_council_codes:    report.findings.orphan_council_codes.length,
    orphan_addresses:        report.findings.orphan_addresses.length,
    unmapped_council_codes:  report.findings.unmapped_council_codes.length,
    empty_addresses:         report.findings.empty_addresses.length,
    within_base_duplicates:  report.findings.within_base_duplicates.length,
    cross_base_duplicates:   report.findings.cross_base_duplicates.length,
  }

  // Apply: delete orphan council codes
  if (apply && report.findings.orphan_council_codes.length > 0) {
    console.log(`\nApplying: deleting ${report.findings.orphan_council_codes.length} orphan Council_Code row(s)...`)
    for (const f of report.findings.orphan_council_codes) {
      await deleteAirtableRecord(f.baseId, AIRTABLE_TABLE_IDS.COUNCIL_CODE, f.recordId, airtableToken)
      console.log(`  ✓ Deleted ${f.recordId} (code="${f.code}") in ${f.baseId}`)
    }
  }

  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  printHumanSummary(report, outputPath, apply)

  // Pre-flight failure → non-zero exit
  if (report.summary.unmapped_council_codes > 0) {
    console.error('\n✗ Unmapped Council_Codes found. Fix Airtable or extend area-map.ts before import.')
    process.exit(1)
  }
}

async function scanBase(
  base: VvBase,
  token: string,
  areaMap: Map<string, string>,
  report: Report,
  crossBaseSeen: Map<string, { baseId: string; recordId: string }[]>,
): Promise<void> {
  console.log(`\nScanning base ${base.key} (${base.baseId})...`)

  const codeLookup = await fetchCouncilCodeLookup(base.baseId, token)
  const properties = await fetchAllEligibleProperties(base.baseId, token)
  report.sources[base.key] = { baseId: base.baseId, rowsScanned: properties.length }
  console.log(`  Fetched ${properties.length} eligible properties, ${codeLookup.size} council codes.`)

  // 1. Orphan Council_Code rows (no linked addresses).
  const codesInUse = new Set<string>()
  for (const p of properties) {
    if (p.councilCode) codesInUse.add(p.councilCode)
  }
  for (const [recordId, code] of codeLookup) {
    if (!codesInUse.has(code)) {
      report.findings.orphan_council_codes.push({ baseId: base.baseId, recordId, code })
    }
  }

  // 2. Orphan addresses (no Council_Code link) + 4. empty addresses.
  // 5. Within-base duplicates (same normalised address + same council code).
  const withinSeen = new Map<string, string[]>()
  for (const p of properties) {
    if (!p.councilCode) {
      report.findings.orphan_addresses.push({
        baseId: base.baseId,
        recordId: p.id,
        address: p.address,
      })
    }
    const trimmed = p.address.trim()
    if (trimmed.length < 4) {
      report.findings.empty_addresses.push({
        baseId: base.baseId,
        recordId: p.id,
        address: p.address,
      })
    }
    const key = `${p.councilCode ?? '<none>'}::${normaliseAddress(p.address)}`
    if (!withinSeen.has(key)) withinSeen.set(key, [])
    withinSeen.get(key)!.push(p.id)

    // 6. Cross-base dedup (just record normalised + base + id; collate later)
    const norm = normaliseAddress(p.address)
    if (norm.length > 0) {
      if (!crossBaseSeen.has(norm)) crossBaseSeen.set(norm, [])
      crossBaseSeen.get(norm)!.push({ baseId: base.baseId, recordId: p.id })
    }
  }
  for (const [key, recordIds] of withinSeen) {
    if (recordIds.length > 1) {
      const [council_code, normalised] = key.split('::')
      report.findings.within_base_duplicates.push({
        baseId: base.baseId,
        council_code,
        normalised,
        records: recordIds,
      })
    }
  }

  // 3. Unmapped Council_Codes — pre-flight against Verco area map.
  const counts = new Map<string, number>()
  for (const p of properties) {
    if (p.councilCode) counts.set(p.councilCode, (counts.get(p.councilCode) ?? 0) + 1)
  }
  for (const [code, count] of counts) {
    const areaId = resolveAreaId(code, areaMap)
    if (!areaId) {
      report.findings.unmapped_council_codes.push({
        baseId: base.baseId,
        code,
        addressCount: count,
      })
    }
  }
}

function printHumanSummary(report: Report, path: string, applied: boolean) {
  const total = Object.values(report.sources).reduce((acc, s) => acc + s.rowsScanned, 0)
  console.log('')
  console.log('Airtable VV Hygiene Report — ' + new Date(report.scannedAt).toLocaleString())
  console.log('═════════════════════════════════════════════════════════')
  console.log(`Scanned: ${total.toLocaleString()} rows across ${Object.keys(report.sources).length} base(s).`)
  console.log('')
  for (const [key, count] of Object.entries(report.summary)) {
    const flag = (key === 'orphan_council_codes' && applied) ? ' (deleted)' :
                 (key === 'unmapped_council_codes' && count > 0) ? ' ✗ pre-flight fail' :
                 (key === 'unmapped_council_codes') ? ' ✓ pre-flight ok' : ''
    console.log(`  ${key.padEnd(28)} ${String(count).padStart(5)}${flag}`)
  }
  console.log('')
  console.log(`Report saved to ${path}`)
  if (!applied && report.summary.orphan_council_codes > 0) {
    console.log(`Re-run with --apply to delete the ${report.summary.orphan_council_codes} orphan Council_Code row(s).`)
  }
}

function timestamp(): string {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit -p tsconfig.json`

Expected: No errors. Fix any type issues inline.

- [ ] **Step 3: Commit**

```bash
git add scripts/airtable-vv-hygiene.ts
git commit -m "feat(scripts): airtable-vv-hygiene script with dry-run and --apply modes"
```

---

## Task 13: Implement the import script

**Files:**
- Create: `scripts/import-vv-properties.ts`

- [ ] **Step 1: Write the script**

```typescript
// scripts/import-vv-properties.ts
/**
 * VV Eligible Properties import — pulls from 3 Airtable bases, geocodes
 * SUB+VIC via Google, upserts to Verco eligible_properties.
 *
 * Idempotent: re-runs skip rows already imported (matched on
 * external_source + external_id). Failed geocodes are logged to a
 * report file and the row is inserted with has_geocode=false.
 *
 * Usage:
 *   npx tsx scripts/import-vv-properties.ts                  # full import
 *   npx tsx scripts/import-vv-properties.ts --dry-run        # no I/O writes
 *   npx tsx scripts/import-vv-properties.ts --source=vic
 *   npx tsx scripts/import-vv-properties.ts --limit=50       # smoke test
 *   npx tsx scripts/import-vv-properties.ts --skip-geocode
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { fetchAllEligibleProperties } from './lib/airtable-vv'
import { loadAreaMap, resolveAreaId } from './lib/area-map'
import { geocodeAddress } from './lib/geocode'
import { toVercoRow } from './lib/transform'
import { fetchExistingExternalIds, upsertEligibleProperties } from './lib/verco-upsert'
import { parseFlags, requireEnv } from './lib/cli'
import { VV_BASES, type AirtableEligibleProperty, type EligiblePropertyInsert, type VvBase } from './lib/types'

const GEOCODE_QPS = 50      // Google default
const GEOCODE_INTERVAL_MS = Math.ceil(1000 / GEOCODE_QPS)

async function main() {
  const flags = parseFlags(process.argv)
  const dryRun = !!flags['dry-run']
  const skipGeocode = !!flags['skip-geocode']
  const sourceFilter = (flags.source as string | undefined) ?? 'all'
  const limit = flags.limit ? Number(flags.limit) : null

  const airtableToken = requireEnv('AIRTABLE_TOKEN')
  const supabaseUrl   = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey    = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const googleKey     = skipGeocode ? '' : requireEnv('GOOGLE_GEOCODING_API_KEY')

  const verco = createClient(supabaseUrl, serviceKey)
  const areaMap = await loadAreaMap(verco)
  console.log(`Loaded ${areaMap.size} Verco collection_areas under vergevalet.`)

  const bases = sourceFilter === 'all'
    ? VV_BASES
    : VV_BASES.filter((b) => b.key === sourceFilter)
  if (bases.length === 0) {
    console.error(`Unknown source: ${sourceFilter}. Use main, sub, vic, or all.`)
    process.exit(1)
  }

  const failedGeocodes: { baseId: string; recordId: string; address: string }[] = []
  const unmappedCodes: { baseId: string; recordId: string; code: string }[] = []
  const counts: Record<string, { newRows: number; skipped: number; upserted: number; failed: number }> = {}

  for (const base of bases) {
    console.log(`\n─── Base ${base.key} (${base.baseId}) ───`)
    const externalSource = `airtable:${base.baseId}`

    // 1. Fetch from Airtable.
    let airtableRows = await fetchAllEligibleProperties(base.baseId, airtableToken)
    if (limit) airtableRows = airtableRows.slice(0, limit)
    console.log(`  Fetched ${airtableRows.length} rows from Airtable.`)

    // 2. Pre-filter: existing external_ids in Verco for this source.
    const existing = await fetchExistingExternalIds(verco, externalSource)
    const newRows = airtableRows.filter((r) => !existing.has(r.id))
    console.log(`  Existing in Verco: ${existing.size}; New to import: ${newRows.length}`)

    // 3. Geocode (only NEW SUB/VIC rows).
    // 4. Transform + collect insertable rows.
    const insertable: EligiblePropertyInsert[] = []
    for (const row of newRows) {
      const code = row.councilCode
      if (!code) {
        unmappedCodes.push({ baseId: base.baseId, recordId: row.id, code: '<null>' })
        continue
      }
      const areaId = resolveAreaId(code, areaMap)
      if (!areaId) {
        unmappedCodes.push({ baseId: base.baseId, recordId: row.id, code })
        continue
      }

      let geocode = null
      if (!base.hasGeocode && !skipGeocode) {
        const startedAt = Date.now()
        try {
          geocode = await geocodeAddress(row.address, googleKey)
        } catch (err) {
          console.error(`  Geocode error for ${row.id}: ${(err as Error).message}`)
        }
        if (!geocode) {
          failedGeocodes.push({ baseId: base.baseId, recordId: row.id, address: row.address })
        }
        const elapsed = Date.now() - startedAt
        if (elapsed < GEOCODE_INTERVAL_MS) await sleep(GEOCODE_INTERVAL_MS - elapsed)
      }

      insertable.push(toVercoRow(row, base.baseId, areaId, geocode))
    }

    // 5. Upsert (unless dry-run).
    let upsertResult = { ok: 0, failedBatches: 0 }
    if (!dryRun && insertable.length > 0) {
      upsertResult = await upsertEligibleProperties(verco, insertable, (done, total) => {
        process.stdout.write(`\r  Upserting... ${done}/${total}`)
      })
      process.stdout.write('\n')
    } else if (dryRun) {
      console.log(`  DRY RUN — would upsert ${insertable.length} rows.`)
    }

    counts[base.key] = {
      newRows: newRows.length,
      skipped: airtableRows.length - newRows.length,
      upserted: upsertResult.ok,
      failed: upsertResult.failedBatches * 500, // approx; batch granularity
    }
  }

  // 6. Hard abort on unmapped codes (defensive — hygiene should catch first).
  if (unmappedCodes.length > 0) {
    console.error(`\n✗ ${unmappedCodes.length} row(s) had unmapped Council_Codes. Sample:`)
    for (const u of unmappedCodes.slice(0, 5)) {
      console.error(`    ${u.baseId} ${u.recordId} code="${u.code}"`)
    }
    process.exit(1)
  }

  // 7. Save report.
  const report = {
    completedAt: new Date().toISOString(),
    dryRun,
    counts,
    failedGeocodes,
  }
  const path = `import-vv-report-${timestamp()}.json`
  writeFileSync(path, JSON.stringify(report, null, 2))

  console.log('\n═════════════════════════════════════════════════════════')
  console.log(`Done. ${dryRun ? '(DRY RUN — no writes)' : ''}`)
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(5)}  new=${v.newRows}  skipped=${v.skipped}  upserted=${v.upserted}  failed=${v.failed}`)
  }
  console.log(`Failed geocodes: ${failedGeocodes.length}`)
  console.log(`Report: ${path}`)
  console.log('')
  console.log('Run these verification queries against Verco:')
  console.log("  SELECT ca.code, count(*) FROM eligible_properties ep")
  console.log("    JOIN collection_area ca ON ca.id = ep.collection_area_id")
  console.log("    JOIN client c ON c.id = ca.client_id")
  console.log("    WHERE c.slug = 'vergevalet' GROUP BY ca.code ORDER BY ca.code;")
  console.log('')
  console.log("  SELECT external_source, count(*) total,")
  console.log("    count(*) FILTER (WHERE has_geocode) geocoded,")
  console.log("    round(100.0 * count(*) FILTER (WHERE has_geocode) / count(*), 1) pct")
  console.log("  FROM eligible_properties WHERE external_source LIKE 'airtable:%'")
  console.log("  GROUP BY external_source;")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function timestamp(): string {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit -p tsconfig.json`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/import-vv-properties.ts
git commit -m "feat(scripts): import-vv-properties with idempotent upsert + geocoding"
```

---

## Task 14: Smoke-test the scripts with a `--limit` run

This task is **manual**. The engineer needs working env vars and Google API access. Skip if env is not yet wired up — flag for Dan to do during go-live.

- [ ] **Step 1: Confirm env vars**

```bash
grep -E "AIRTABLE_TOKEN|GOOGLE_GEOCODING_API_KEY|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL" .env.local
```

Expected: All four variables populated.

- [ ] **Step 2: Smoke-test hygiene script (dry-run, just main base)**

Run: `npx tsx scripts/airtable-vv-hygiene.ts --base=main`

Expected: Prints a human summary, writes a JSON report, exits 0 (no unmapped codes).

- [ ] **Step 3: Smoke-test import script (dry-run, limit 50, just VIC)**

> Tasks 15–17 below also require the migration to be live in remote — if you haven't applied it yet, skip this step until after Task 17.

Run: `npx tsx scripts/import-vv-properties.ts --dry-run --source=vic --limit=50 --skip-geocode`

Expected: Logs "DRY RUN — would upsert 50 rows". Counts in report show 50 new / 0 upserted.

- [ ] **Step 4: Document any smoke-test surprises**

Make notes in the PR description on what you observed. No commit needed.

---

## Task 15: Apply migration to remote Verco Supabase

**This is a go-live step.** Do not run until the migration PR has been reviewed and merged.

- [ ] **Step 1: Confirm you're on the merged branch**

```bash
git checkout main
git pull
git log --oneline -3
```

Expected: Top commit is the merged PR for this work.

- [ ] **Step 2: Push the migration**

Run: `pnpm supabase db push`

Expected: Migration applies cleanly. No errors.

- [ ] **Step 3: Verify scaffolding landed**

Run via Supabase MCP `execute_sql` or SQL Editor:

```sql
SELECT 'client'    AS table, count(*) FROM client       WHERE slug = 'vergevalet'
UNION ALL
SELECT 'sub_client', count(*) FROM sub_client
  WHERE client_id = (SELECT id FROM client WHERE slug='vergevalet')
UNION ALL
SELECT 'collection_area', count(*) FROM collection_area
  WHERE client_id = (SELECT id FROM client WHERE slug='vergevalet');
```

Expected: `client=1`, `sub_client=9`, `collection_area=11`.

- [ ] **Step 4: Verify the schema change**

```sql
SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name='eligible_properties' AND column_name LIKE 'external%';
```

Expected: Two rows — `external_source text`, `external_id text`.

---

## Task 16: Regenerate Supabase TypeScript types (optional, for Verco app awareness)

The import scripts do not depend on `src/lib/supabase/types.ts` (they define their own types), but the Verco web app should know about the new `external_source` + `external_id` columns for admin UI awareness.

- [ ] **Step 1: Regenerate types**

```bash
pnpm supabase gen types typescript \
  --project-id tfddjmplcizfirxqhotv \
  > src/lib/supabase/types.ts
```

- [ ] **Step 2: Strip any CLI warnings appended to the file**

Read the bottom of `src/lib/supabase/types.ts`. If there are non-TypeScript warning lines (the Supabase CLI sometimes appends them), delete them.

- [ ] **Step 3: Type-check the whole app**

Run: `pnpm tsc --noEmit -p tsconfig.json`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/types.ts
git commit -m "chore(types): regen after WMRC scaffolding migration"
```

---

## Task 17: Run hygiene script (dry-run, then apply)

**Go-live step.** Requires env vars + applied migration (Task 15).

- [ ] **Step 1: Dry-run hygiene scan across all 3 bases**

Run: `npx tsx scripts/airtable-vv-hygiene.ts`

Expected: Report written to `airtable-vv-hygiene-report-<ts>.json`. Human summary printed.

- [ ] **Step 2: Review the report with Dan**

Specifically confirm:
- At least 1 `orphan_council_codes` (the known `"4c "` in VIC base) — expected
- 0 `unmapped_council_codes` — required (else import will abort)
- Surface `within_base_duplicates` and `cross_base_duplicates` counts for ops awareness

- [ ] **Step 3: Apply (if Dan approves)**

Run: `npx tsx scripts/airtable-vv-hygiene.ts --apply`

Expected: Orphan Council_Code rows deleted. Exit code 0.

---

## Task 18: Import dry-run

**Go-live step.** Requires Task 17 clean.

- [ ] **Step 1: Run the dry-run**

Run: `npx tsx scripts/import-vv-properties.ts --dry-run`

Expected: ~30 sec for fetches. Logs counts: `main new≈68113`, `sub new≈6571`, `vic new≈14358`. No Google calls (skipped via dry-run logic skipping upsert + not strictly needed for dry-run — though if you want to test the geocode plumbing, run `--source=vic --limit=10` separately without `--dry-run`).

- [ ] **Step 2: Sanity-check the per-base counts**

The expected numbers (per the spec):

| base | expected new on first run |
|---|---|
| main | ~68,113 |
| sub  | ~6,571 |
| vic  | ~14,358 |

If counts are wildly different, stop and investigate before going live.

---

## Task 19: Import live

**Go-live step. This is the big one.** ~11 minutes wall-clock. Cost: ~$105 USD in Google Geocoding charges.

- [ ] **Step 1: Confirm Google Cloud billing + quota**

In Google Cloud Console for the project hosting the API key:
- Billing is enabled
- Geocoding API quota ≥ 25,000 requests/day

- [ ] **Step 2: Run the full import**

Run: `npx tsx scripts/import-vv-properties.ts`

Expected timing:
- ~30 sec fetch
- ~7 min geocode (21k rows × 50 QPS)
- ~3 min upsert
- Total ~11 min

If the script dies partway, just re-run it — the pre-filter will skip already-imported rows.

- [ ] **Step 3: Save the import report**

The script writes `import-vv-report-<ts>.json`. Don't lose this — it's the audit record (which rows imported, which geocodes failed).

```bash
mv import-vv-report-*.json ~/Documents/verco/
```

---

## Task 20: Post-import verification

**Go-live step.**

- [ ] **Step 1: Row counts per area**

Run via Supabase SQL Editor:

```sql
SELECT ca.code, count(*) AS properties
  FROM eligible_properties ep
  JOIN collection_area ca ON ca.id = ep.collection_area_id
  JOIN client c ON c.id = ca.client_id
  WHERE c.slug = 'vergevalet'
  GROUP BY ca.code ORDER BY ca.code;
```

Expected: 11 rows. Sum across all rows ≈ 89,042 (post-dedup may be slightly lower).

- [ ] **Step 2: Geocode coverage**

```sql
SELECT external_source,
       count(*) total,
       count(*) FILTER (WHERE has_geocode) geocoded,
       round(100.0 * count(*) FILTER (WHERE has_geocode) / count(*), 1) pct
  FROM eligible_properties
  WHERE external_source LIKE 'airtable:%'
  GROUP BY external_source;
```

Expected:
- `airtable:appWSysd50QoVaaRD` → ~100% geocoded (Main base had lat/long)
- `airtable:appuf7kTSNFXi7Rp0` → 95%+ geocoded (SUB via Google)
- `airtable:appIgPfNX8SYS9QIq` → 95%+ geocoded (VIC via Google)

If any source < 90%, investigate via the report's `failedGeocodes` list.

- [ ] **Step 3: Spot-check known addresses**

```sql
-- Known Cottesloe address from earlier discovery
SELECT id, address, formatted_address, has_geocode, latitude, longitude
  FROM eligible_properties
  WHERE address ILIKE '%marine parade%cottesloe%' LIMIT 5;
```

Expected: At least one row. `collection_area_id` should resolve to the `COT` area.

- [ ] **Step 4: Manual `/book` smoke**

In a browser: visit `vergevalet.verco.au/book` (staging or prod). Start typing a real address from one of the VIC samples. Confirm autocomplete resolves to the `VIC` collection area. **Do not submit a booking** — allocation rules are not yet configured.

- [ ] **Step 5: Mark go-live complete**

Post in #ops Slack or DM Dan with:
- Total rows imported per area (from Step 1)
- Geocode coverage per source (from Step 2)
- Path to the saved import report
- Confirmation that residents cannot yet book (no rules) — next step is client-config admin UI rules.

---

## Self-review notes

- All 5 spec sections (architecture, migration, import script, hygiene, testing/rollback) map to tasks:
  - Architecture & artifacts → Task 1 (migration), 12 (hygiene), 13 (import)
  - Migration detail → Task 1
  - Import script detail → Tasks 4–11 (lib) + 13 (script)
  - Airtable hygiene detail → Tasks 5 (normalise shared) + 12
  - Testing & verification → Tasks 5–7 (unit) + 14 (smoke) + 18 (dry-run) + 20 (verification)
  - Rollback plan → documented in spec; not a separate task (commands ready if needed)
- Types referenced in later tasks (`AirtableEligibleProperty`, `EligiblePropertyInsert`, `GeocodeResult`, `VvBase`) all defined in Task 4.
- All function names consistent across tasks: `normaliseAddress`, `toVercoRow`, `geocodeAddress`, `fetchAllEligibleProperties`, `loadAreaMap`, `resolveAreaId`, `upsertEligibleProperties`, `fetchExistingExternalIds`.
- No placeholders — every step has concrete code or a concrete command.
