/**
 * Pure helpers for the geocode-properties EF chunked-loop runner.
 *
 * Kept dependency-free so they can be unit-tested without network/env setup.
 * The CLI driver in scripts/run-geocode-loop.ts wires these into an actual
 * fetch loop against Supabase.
 */

export type GeocodeEfResponse = {
  message: string
  total: number
  processed: number
  failed: number
  dry_run: boolean
  errors?: Array<{ id: string; error: string }>
}

export type ParsedChunk =
  | { ok: true; data: GeocodeEfResponse }
  | { ok: false; error: string }

/**
 * Defensive parse of the geocode-properties EF response body. The EF is
 * trusted but we still gate on shape so a deploy-time regression in the
 * EF surfaces as a clean abort here rather than a NaN-laced loop.
 */
export function parseEfResponse(raw: unknown): ParsedChunk {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: `Non-object response: ${JSON.stringify(raw)}` }
  }
  const r = raw as Record<string, unknown>

  if (typeof r.error === 'string') {
    return { ok: false, error: r.error }
  }

  // Tolerate the EF's no-rows envelope having no `failed` field. Older EF
  // builds emitted `{message, processed:0, total:0}` and tripped the parser
  // on every clean completion. Treat missing `failed` as 0 only when there
  // is genuinely nothing to fail — i.e. total === 0 AND processed === 0.
  const totalIsZero = r.total === 0 && r.processed === 0
  const failedFallback = totalIsZero && r.failed === undefined ? 0 : r.failed

  if (
    typeof r.total !== 'number' ||
    typeof r.processed !== 'number' ||
    typeof failedFallback !== 'number'
  ) {
    return {
      ok: false,
      error: `Malformed response, missing total/processed/failed: ${JSON.stringify(r)}`,
    }
  }

  return {
    ok: true,
    data: {
      message: typeof r.message === 'string' ? r.message : '',
      total: r.total,
      processed: r.processed,
      failed: failedFallback,
      dry_run: r.dry_run === true,
      errors: Array.isArray(r.errors)
        ? (r.errors as Array<{ id: string; error: string }>)
        : undefined,
    },
  }
}

/**
 * Estimate USD spend for `rows` Google Geocoding API calls, given any
 * remaining free-tier quota the caller wants to net off.
 *
 * Google Maps Platform charges $5 / 1,000 Geocoding calls. The PR review
 * for #19 assumed 10K free remaining for the month — caller passes that
 * (or 0) as `freeQuotaRemaining`.
 */
export function estimateCostUsd(rows: number, freeQuotaRemaining: number): number {
  const billable = Math.max(0, rows - Math.max(0, freeQuotaRemaining))
  return Math.round((billable / 1000) * 5 * 100) / 100
}

/**
 * Format a wall-clock estimate as "Xm Ys" given remaining rows and an
 * observed throughput. Returns "—" when the rate is unknown/zero.
 */
export function formatEta(remainingRows: number, rowsPerSecond: number): string {
  if (!Number.isFinite(rowsPerSecond) || rowsPerSecond <= 0) return '—'
  const seconds = Math.ceil(remainingRows / rowsPerSecond)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

/**
 * EF invocation result, used by the CLI loop to decide whether to keep going.
 */
export type LoopDecision =
  | { kind: 'continue'; processed: number; failed: number; total: number }
  | { kind: 'done'; reason: 'no-rows' }
  | { kind: 'abort'; reason: string }

export function decideNext(
  parsed: ParsedChunk,
  consecutiveFailures: number,
  maxConsecutiveFailures: number,
): LoopDecision {
  if (!parsed.ok) {
    if (consecutiveFailures + 1 >= maxConsecutiveFailures) {
      return {
        kind: 'abort',
        reason: `Hit ${maxConsecutiveFailures} consecutive failures. Last: ${parsed.error}`,
      }
    }
    return { kind: 'continue', processed: 0, failed: 0, total: 0 }
  }
  if (parsed.data.total === 0) {
    return { kind: 'done', reason: 'no-rows' }
  }
  return {
    kind: 'continue',
    processed: parsed.data.processed,
    failed: parsed.data.failed,
    total: parsed.data.total,
  }
}
