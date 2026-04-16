/**
 * VER-177: One-time import of KWN-V eligible properties from DM-Ops → Verco.
 *
 * Usage: npx tsx scripts/import-kwn-properties.ts
 *
 * Reads DM-Ops eligible_properties (18,958 rows, ~18,842 unique by address),
 * maps area FKs, strips ", Australia" suffix, and inserts into Verco.
 */

import { createClient } from '@supabase/supabase-js'

// ── DM-Ops (source — read-only via anon key) ──────────────────
const DMOPS_URL = 'https://vxpsnckxeeerdeajnrjm.supabase.co'
const DMOPS_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4cHNuY2t4ZWVlcmRlYWpucmptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNzU4NDcsImV4cCI6MjA4Njk1MTg0N30.JP48CwU4kRvuep4SmNfdKbCFbeLuryHXm_SgZuV17L4'

// ── Verco (target — service role for INSERT bypassing RLS) ─────
const VERCO_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const VERCO_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ── FK mapping: DM-Ops account_job_area_id → Verco collection_area_id
const AREA_MAP: Record<string, string> = {
  '565bfc8b-dcea-4a6a-916e-4e6b803242e6': 'dc857d39-832f-4ffd-b959-14e579e67d90', // KWN-1
  '72c4f690-3651-4ce9-b46e-29cc5da9dc16': '9594d907-89a7-4374-870c-caa51627b677', // KWN-2
  '49152700-3b2c-4c7a-9434-af7be108f2a1': '1ba489fc-d50a-4f87-9c0a-4518b4260c2d', // KWN-3
  '7d415175-b19d-4f15-9ac1-347e4b2fc6c8': 'd9f8e762-5376-410e-8855-bc73048724b4', // KWN-4
}

const FETCH_PAGE_SIZE = 1000
const INSERT_BATCH_SIZE = 500

interface DmOpsRow {
  formatted_address: string
  latitude: number
  longitude: number
  google_place_id: string | null
  has_geocode: boolean
  account_job_area_id: string
}

async function main() {
  if (!VERCO_URL || !VERCO_SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }

  const dmops = createClient(DMOPS_URL, DMOPS_ANON_KEY)
  const verco = createClient(VERCO_URL, VERCO_SERVICE_KEY)

  // ── 1. Fetch all rows from DM-Ops ────────────────────────────
  console.log('Fetching from DM-Ops...')
  const allRows: DmOpsRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await dmops
      .from('eligible_properties')
      .select('formatted_address, latitude, longitude, google_place_id, has_geocode, account_job_area_id')
      .order('formatted_address')
      .range(offset, offset + FETCH_PAGE_SIZE - 1)

    if (error) {
      console.error(`Fetch error at offset ${offset}:`, error.message)
      process.exit(1)
    }

    if (!data || data.length === 0) break
    allRows.push(...(data as DmOpsRow[]))
    console.log(`  fetched ${allRows.length} rows...`)
    offset += FETCH_PAGE_SIZE

    if (data.length < FETCH_PAGE_SIZE) break
  }

  console.log(`Total fetched: ${allRows.length}`)

  // ── 2. Deduplicate by formatted_address ──────────────────────
  const seen = new Set<string>()
  const unique: DmOpsRow[] = []

  for (const row of allRows) {
    if (!seen.has(row.formatted_address)) {
      seen.add(row.formatted_address)
      unique.push(row)
    }
  }

  console.log(`Unique addresses: ${unique.length} (${allRows.length - unique.length} duplicates removed)`)

  // ── 3. Transform ─────────────────────────────────────────────
  const transformed = unique.map((row) => {
    const addr = row.formatted_address.replace(/, Australia$/, '')
    const collectionAreaId = AREA_MAP[row.account_job_area_id]
    if (!collectionAreaId) {
      console.error(`Unknown area ID: ${row.account_job_area_id} for ${row.formatted_address}`)
      process.exit(1)
    }

    return {
      address: addr,
      formatted_address: addr,
      latitude: row.latitude,
      longitude: row.longitude,
      google_place_id: row.google_place_id,
      has_geocode: row.has_geocode,
      collection_area_id: collectionAreaId,
      is_mud: false,
      is_eligible: true,
      unit_count: 1,
    }
  })

  // ── 4. Insert into Verco in batches ──────────────────────────
  console.log(`Inserting ${transformed.length} rows into Verco...`)
  let inserted = 0

  for (let i = 0; i < transformed.length; i += INSERT_BATCH_SIZE) {
    const batch = transformed.slice(i, i + INSERT_BATCH_SIZE)
    const { error } = await verco.from('eligible_properties').insert(batch)

    if (error) {
      console.error(`Insert error at batch starting ${i}:`, error.message)
      process.exit(1)
    }

    inserted += batch.length
    console.log(`  inserted ${inserted} / ${transformed.length}`)
  }

  // ── 5. Verify counts ────────────────────────────────────────
  console.log('\nVerifying...')
  const { count: total } = await verco.from('eligible_properties').select('*', { count: 'exact', head: true })

  const areaCounts: Record<string, number> = {}
  for (const [dmId, vercoId] of Object.entries(AREA_MAP)) {
    const { count } = await verco
      .from('eligible_properties')
      .select('*', { count: 'exact', head: true })
      .eq('collection_area_id', vercoId)
    const areaName = ['KWN-1', 'KWN-2', 'KWN-3', 'KWN-4'][Object.keys(AREA_MAP).indexOf(dmId)]
    areaCounts[areaName] = count ?? 0
  }

  console.log(`\nTotal: ${total}`)
  for (const [area, count] of Object.entries(areaCounts)) {
    console.log(`  ${area}: ${count}`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
