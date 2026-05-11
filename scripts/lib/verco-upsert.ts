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
