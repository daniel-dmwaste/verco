'use server'

import { createClient } from '@/lib/supabase/server'
import { invokeSendNotification } from '@/lib/notifications/invoke'

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

export async function retryNotification(logId: string): Promise<Result<void>> {
  if (!logId) {
    return { ok: false, error: 'Log ID is required.' }
  }

  const supabase = await createClient()

  // Verify admin role
  const { data: role } = await supabase.rpc('current_user_role')
  const adminRoles = ['client-admin', 'client-staff', 'contractor-admin', 'contractor-staff']
  if (!role || !adminRoles.includes(role)) {
    return { ok: false, error: 'Insufficient permissions.' }
  }

  // Lock the row, validate failed status, set to queued.
  // RPC not yet in generated types — will be after migration is applied + types regenerated
  const { error: rpcError } = await (supabase.rpc as Function)(
    'retry_notification_log',
    { log_id: logId }
  )

  if (rpcError) {
    return { ok: false, error: rpcError.message }
  }

  // Dispatch via resume-by-log-id path (fire-and-forget)
  await invokeSendNotification(supabase, { notification_log_id: logId })

  return { ok: true, data: undefined }
}