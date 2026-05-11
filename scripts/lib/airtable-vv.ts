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
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
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
