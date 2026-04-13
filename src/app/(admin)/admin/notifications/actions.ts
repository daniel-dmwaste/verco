'use server'

import { createClient } from '@/lib/supabase/server'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcError } = await (supabase as any).rpc('retry_notification_log', {
    log_id: logId,
  })

  if (rpcError) {
    return { ok: false, error: rpcError.message }
  }

  // Dispatch via resume-by-log-id path (fire-and-forget)
  await invokeSendNotification(supabase, logId)

  return { ok: true, data: undefined }
}

/**
 * Fire-and-forget POST to the send-notification Edge Function.
 * Uses the resume-by-log-id input variant from Phase 4.
 */
async function invokeSendNotification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notificationLogId: string
): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    if (!supabaseUrl) {
      console.error(
        '[notifications] NEXT_PUBLIC_SUPABASE_URL not set — skipping send-notification'
      )
      return
    }
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) {
      console.error(
        '[notifications] No session access token — skipping send-notification'
      )
      return
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notification_log_id: notificationLogId }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      console.error(
        `[notifications] send-notification returned ${res.status} for retry ${notificationLogId}: ${body}`
      )
    }
  } catch (err) {
    console.error(
      `[notifications] Failed to invoke send-notification for retry ${notificationLogId}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}
