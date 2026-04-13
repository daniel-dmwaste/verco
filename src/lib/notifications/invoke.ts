import { createClient } from '@/lib/supabase/server'
import type { NotificationPayload, NotificationResumePayload } from './templates/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Fire-and-forget POST to the send-notification Edge Function.
 *
 * Uses the user's session access token (not service role — CLAUDE.md §20).
 * The EF accepts user JWTs and validates the role before dispatching.
 *
 * Accepts either a standard payload (for new notifications) or a resume
 * payload (for retry by notification_log_id).
 *
 * Fire-and-forget: the caller's primary operation has already committed.
 * Notification failure is logged but never propagated.
 */
export async function invokeSendNotification(
  supabase: SupabaseServerClient,
  input: NotificationPayload | NotificationResumePayload
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
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      const label =
        'type' in input
          ? `${input.type} ${input.booking_id}`
          : `retry ${input.notification_log_id}`
      console.error(
        `[notifications] send-notification returned ${res.status} for ${label}: ${body}`
      )
    }
  } catch (err) {
    const label = 'type' in input ? `${input.type}` : 'retry'
    console.error(
      `[notifications] Failed to invoke send-notification for ${label}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}
