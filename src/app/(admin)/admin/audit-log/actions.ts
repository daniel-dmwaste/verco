'use server'

import { createClient } from '@/lib/supabase/server'
import { FIELD_LABELS, NOISE_FIELDS, FK_RESOLVE_MAP } from '@/lib/audit/field-labels'
import { format } from 'date-fns'
import { resolveActorNames, type ResolvedAuditEntry, type AuditChange } from '@/lib/audit/resolve'

interface FetchAuditLogsParams {
  tableName?: string
  action?: string
  limit?: number
  offset?: number
}

const TABLE_LABELS: Record<string, string> = {
  booking: 'Booking',
  booking_item: 'Service item',
  non_conformance_notice: 'NCN',
  nothing_presented: 'Nothing Presented',
  service_ticket: 'Ticket',
  ticket_response: 'Response',
  collection_date: 'Collection date',
  strata_user_properties: 'MUD property link',
  contacts: 'Contact',
  eligible_properties: 'Property',
}

export async function fetchAuditLogs(
  params: FetchAuditLogsParams
): Promise<{ ok: true; data: ResolvedAuditEntry[]; total: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { tableName, action, limit = 50, offset = 0 } = params

  let query = supabase
    .from('audit_log')
    .select('id, table_name, record_id, action, old_data, new_data, changed_by, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (tableName) query = query.eq('table_name', tableName)
  if (action) query = query.eq('action', action)

  const { data: entries, error, count } = await query

  if (error) return { ok: false, error: error.message }
  if (!entries) return { ok: true, data: [], total: 0 }

  // Resolve actor names (display_name → contacts.full_name fallback)
  const actorIds = [...new Set(entries.map((e) => e.changed_by).filter(Boolean))] as string[]
  const actorMap = await resolveActorNames(supabase, actorIds)

  // Collect FK UUIDs for label resolution
  const fkUuids: Record<string, Set<string>> = {}
  for (const entry of entries) {
    for (const data of [entry.old_data, entry.new_data]) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue
      const record = data as Record<string, unknown>
      for (const [col, val] of Object.entries(record)) {
        if (col in FK_RESOLVE_MAP && typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
          if (!fkUuids[col]) fkUuids[col] = new Set()
          fkUuids[col].add(val)
        }
      }
    }
  }

  // Resolve FK labels
  const fkLabelMap: Record<string, string> = {}
  for (const [col, uuids] of Object.entries(fkUuids)) {
    const spec = FK_RESOLVE_MAP[col]
    if (!spec || uuids.size === 0) continue
    const ids = [...uuids]
    const { data } = await supabase
      .from(spec.table as 'booking')
      .select(`id, ${spec.column}`)
      .in('id', ids) as { data: Array<Record<string, unknown>> | null }
    if (data) {
      for (const row of data) {
        const id = row.id as string
        const label = row[spec.column]
        if (label != null) fkLabelMap[id] = String(label)
      }
    }
  }

  // Build resolved entries
  const resolved: ResolvedAuditEntry[] = entries.map((entry) => {
    const oldData = entry.old_data as Record<string, unknown> | null
    const newData = entry.new_data as Record<string, unknown> | null
    const changes = diffData(oldData, newData, fkLabelMap)
    const tableLabel = TABLE_LABELS[entry.table_name] ?? entry.table_name

    let summary: string
    if (entry.action === 'INSERT') summary = `${tableLabel} created`
    else if (entry.action === 'DELETE') summary = `${tableLabel} deleted`
    else {
      const statusChange = changes.find((c) => c.field === 'Status')
      if (statusChange?.newValue) summary = `${tableLabel} status → ${statusChange.newValue}`
      else if (changes.length === 1) summary = `${tableLabel}: ${changes[0].field} updated`
      else summary = `${tableLabel}: ${changes.length} fields updated`
    }

    return {
      id: entry.id,
      action: entry.action,
      tableName: entry.table_name,
      summary,
      actorName: entry.changed_by ? (actorMap[entry.changed_by] ?? null) : null,
      createdAt: entry.created_at,
      changes,
    }
  })

  return { ok: true, data: resolved, total: count ?? entries.length }
}

function diffData(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
  fkLabelMap: Record<string, string>,
): AuditChange[] {
  const changes: AuditChange[] = []

  if (!oldData && newData) {
    for (const [col, val] of Object.entries(newData)) {
      if (NOISE_FIELDS.has(col)) continue
      changes.push({ field: FIELD_LABELS[col] ?? col, oldValue: null, newValue: fmtVal(col, val, fkLabelMap) })
    }
    return changes
  }

  if (oldData && !newData) {
    for (const [col, val] of Object.entries(oldData)) {
      if (NOISE_FIELDS.has(col)) continue
      changes.push({ field: FIELD_LABELS[col] ?? col, oldValue: fmtVal(col, val, fkLabelMap), newValue: null })
    }
    return changes
  }

  if (!oldData || !newData) return changes

  const allCols = new Set([...Object.keys(oldData), ...Object.keys(newData)])
  for (const col of allCols) {
    if (NOISE_FIELDS.has(col)) continue
    const oldVal = oldData[col]
    const newVal = newData[col]
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue
    changes.push({ field: FIELD_LABELS[col] ?? col, oldValue: fmtVal(col, oldVal, fkLabelMap), newValue: fmtVal(col, newVal, fkLabelMap) })
  }

  return changes
}

function fmtVal(col: string, val: unknown, fkLabelMap: Record<string, string>): string | null {
  if (val === null || val === undefined) return null
  if (col in FK_RESOLVE_MAP && typeof val === 'string' && /^[0-9a-f]{8}-/i.test(val)) {
    return fkLabelMap[val] ?? 'Unknown'
  }
  if (col === 'unit_price_cents' && typeof val === 'number') return `$${(val / 100).toFixed(2)}`
  if (col === 'contractor_fault' || col === 'is_extra' || col === 'is_mud' || col === 'is_internal') return val ? 'Yes' : 'No'
  if (col === 'is_open') return val ? 'Open' : 'Closed'
  if ((col === 'date' || col === 'rescheduled_date') && typeof val === 'string') {
    try { return format(new Date(val), 'd MMM yyyy') } catch { return val }
  }
  if (col.endsWith('_at') && typeof val === 'string') {
    try { return format(new Date(val), 'd MMM yyyy, h:mmaaa') } catch { return val }
  }
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}
