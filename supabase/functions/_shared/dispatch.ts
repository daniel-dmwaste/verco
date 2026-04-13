import type {
  BookingForDispatch,
  DispatchResult,
  NotificationDispatchInput,
  NotificationLogRow,
  NotificationPayload,
  NotificationType,
  SendEmailParams,
  SendEmailResult,
} from './templates/types.ts'
import { renderBookingCreated } from './templates/booking-created.ts'
import {
  renderBookingCancelled,
  type RenderBookingCancelledOptions,
} from './templates/booking-cancelled.ts'

// Re-export the shared types so callers can continue importing them from
// '@/lib/notifications/dispatch' (single import point for the dispatcher
// contract + data shapes).
export type {
  BookingContactForDispatch,
  BookingClientForDispatch,
  BookingItemForDispatch,
  BookingForDispatch,
  NotificationLogRow,
  SendEmailParams,
  SendEmailResult,
} from './templates/types.ts'

/**
 * Notification dispatcher — pure orchestration logic with dependency
 * injection for testability.
 *
 * Node-side dispatcher. The Deno Edge Function (`supabase/functions/
 * send-notification/index.ts`) wires real Supabase queries and the
 * SendGrid helper into the same contract and calls through. Kept in
 * sync manually.
 *
 * ## Flow
 *
 *   1. Reject the resume-by-log-id variant (Phase 4 feature, stubbed here)
 *   2. Idempotency check — skip if a `sent` row already exists
 *   3. Load the booking — short-circuit with clean error if not found,
 *      write nothing to notification_log (avoids FK violation on client_id)
 *   4. Validate the contact has an email address
 *   5. Render the template for this notification type
 *   6. Call sendEmail
 *   7. Write notification_log row (sent or failed)
 *   8. Emit structured console.log per contract in templates/types.ts
 *   9. Return DispatchResult
 *
 * Never throws — all failure modes are encoded in the DispatchResult. The
 * try/catch at the top is defence-in-depth against future bugs that
 * introduce an accidental throw.
 */

// ── Dispatcher dependency contract ─────────────────────────────────────────

/**
 * Dependency contract for the dispatcher. Tests inject mocks; the EF
 * injects real Supabase queries and the SendGrid helper.
 */
export interface DispatchDeps {
  /** Load full booking context; return null if not found. */
  loadBooking: (booking_id: string) => Promise<BookingForDispatch | null>
  /** Check idempotency — returns true if (booking_id, type) is already 'sent'. */
  isAlreadySent: (booking_id: string, type: NotificationType) => Promise<boolean>
  /** Insert a notification_log row; return the new id on success, null on failure. */
  writeLog: (row: NotificationLogRow) => Promise<string | null>
  /** Send an email via SendGrid (or a mock). Never throws. */
  sendEmail: (params: SendEmailParams) => Promise<SendEmailResult>
  /** Base app URL for building CTA links — e.g. `https://verco.au` */
  appUrl: string
  /** Fallback from-address when the client has no reply_to_email configured */
  defaultFromEmail: string
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export async function dispatch(
  deps: DispatchDeps,
  input: NotificationDispatchInput
): Promise<DispatchResult> {
  const start = Date.now()
  const log = (extras: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        event: 'notification_dispatch',
        duration_ms: Date.now() - start,
        ...extras,
      })
    )
  }

  // Phase 4 will handle the resume-by-log-id variant. Phase 1 only supports
  // the primary payload variant.
  if ('notification_log_id' in input) {
    const error = 'Resume-by-log-id path lands in Phase 4 (VER-122)'
    log({ type: null, status: 'failed', error })
    return { ok: false, error }
  }

  const payload: NotificationPayload = input
  const baseLog = { booking_id: payload.booking_id, type: payload.type }

  try {
    // 1. Idempotency check
    const alreadySent = await deps.isAlreadySent(payload.booking_id, payload.type)
    if (alreadySent) {
      log({ ...baseLog, status: 'skipped', sendgrid_status: null })
      return { ok: true, skipped: true }
    }

    // 2. Load booking — short-circuit on not found
    const booking = await deps.loadBooking(payload.booking_id)
    if (!booking) {
      const error = `Booking not found: ${payload.booking_id}`
      log({ ...baseLog, status: 'failed', error, sendgrid_status: null })
      // Do NOT write to notification_log — we don't have a valid client_id,
      // and the FK would reject anyway. Return a clean error instead.
      return { ok: false, error }
    }

    // 3. Validate contact email
    if (!booking.contact || !booking.contact.email) {
      const error = `Booking ${payload.booking_id} has no contact email`
      const logId = await deps.writeLog({
        booking_id: booking.id,
        contact_id: booking.contact?.id ?? null,
        client_id: booking.client_id,
        channel: 'email',
        notification_type: payload.type,
        to_address: 'unknown',
        status: 'failed',
        error_message: error,
      })
      log({ ...baseLog, status: 'failed', error, sendgrid_status: null })
      return { ok: false, error, log_id: logId ?? undefined }
    }

    // 4. Render template
    let rendered: { subject: string; html: string }
    try {
      rendered = renderTemplate(payload, booking, deps.appUrl)
    } catch (renderErr) {
      const error =
        renderErr instanceof Error ? renderErr.message : String(renderErr)
      const logId = await deps.writeLog({
        booking_id: booking.id,
        contact_id: booking.contact.id,
        client_id: booking.client_id,
        channel: 'email',
        notification_type: payload.type,
        to_address: booking.contact.email,
        status: 'failed',
        error_message: `Template render failed: ${error}`,
      })
      log({
        ...baseLog,
        status: 'failed',
        error: `render: ${error}`,
        sendgrid_status: null,
      })
      return { ok: false, error, log_id: logId ?? undefined }
    }

    // 5. Send email
    const fromEmail = booking.client.reply_to_email ?? deps.defaultFromEmail
    const fromName = booking.client.email_from_name ?? booking.client.name
    const sendResult = await deps.sendEmail({
      to: { email: booking.contact.email, name: booking.contact.full_name },
      from: { email: fromEmail, name: fromName },
      subject: rendered.subject,
      htmlBody: rendered.html,
    })

    // 6. Write notification_log
    const logId = await deps.writeLog({
      booking_id: booking.id,
      contact_id: booking.contact.id,
      client_id: booking.client_id,
      channel: 'email',
      notification_type: payload.type,
      to_address: booking.contact.email,
      status: sendResult.ok ? 'sent' : 'failed',
      error_message: sendResult.ok ? undefined : sendResult.error,
    })

    log({
      ...baseLog,
      status: sendResult.ok ? 'sent' : 'failed',
      sendgrid_status: sendResult.ok ? 202 : sendResult.status ?? null,
      ...(sendResult.ok ? {} : { error: sendResult.error }),
    })

    if (sendResult.ok) {
      return { ok: true, sent: true, log_id: logId ?? '' }
    }
    return { ok: false, error: sendResult.error, log_id: logId ?? undefined }
  } catch (err) {
    // Defensive guard — dispatch should never throw. If it somehow does,
    // log the crash and return a clean error so the caller doesn't propagate.
    const error = err instanceof Error ? err.message : String(err)
    log({
      ...baseLog,
      status: 'failed',
      error: `crashed: ${error}`,
      sendgrid_status: null,
    })
    return { ok: false, error }
  }
}

// ── Template dispatch ──────────────────────────────────────────────────────

function renderTemplate(
  payload: NotificationPayload,
  booking: BookingForDispatch,
  appUrl: string
): { subject: string; html: string } {
  switch (payload.type) {
    case 'booking_created':
      return renderBookingCreated(booking, appUrl)
    case 'booking_cancelled': {
      const opts: RenderBookingCancelledOptions = {
        reason: payload.reason,
        refund_status: payload.refund_status,
      }
      return renderBookingCancelled(booking, appUrl, opts)
    }
    case 'payment_reminder':
    case 'payment_expired':
    case 'ncn_raised':
    case 'np_raised':
    case 'completion_survey':
      throw new Error(
        `Template not yet implemented for type: ${payload.type} (lands in later phase)`
      )
  }
}
