'use server'

import { createClient } from '@/lib/supabase/server'
import { resolveAuditLogs, type ResolvedAuditEntry } from '@/lib/audit/resolve'

export async function fetchCollectionDateAudit(
  dateId: string,
): Promise<ResolvedAuditEntry[]> {
  const supabase = await createClient()
  return resolveAuditLogs(supabase, 'collection_date', dateId)
}
