/**
 * Notification payload types and dispatcher contract.
 *
 * All notifications flow through a single `send-notification` Edge Function
 * that accepts a discriminated union payload, resolves booking + contact +
 * client server-side (with service role — field callers never touch PII),
 * renders the appropriate template via `_layout.ts`, and logs the attempt
 * to `notification_log`.
 *
 * Mirrored between Node (`src/lib/notifications/templates/types.ts`) and
 * Deno (`supabase/functions/_shared/templates/types.ts`). CI guard enforces
 * that the two stay in sync — see `.github/workflows/ci.yml` → template-sync.
 *
 * ## Structured logging contract
 *
 * Every dispatcher attempt MUST emit exactly one JSON line to stdout:
 *
 *   console.log(JSON.stringify({
 *     event: 'notification_dispatch',
 *     booking_id: string,
 *     type: NotificationType,
 *     duration_ms: number,
 *     sendgrid_status: number | null,  // HTTP status from SendGrid, null if never reached
 *     error?: string,                   // only set when result is 'failed'
 *   }))
 *
 * Supabase log drain picks this up for downstream analysis. Do NOT log
 * contact PII fields — the whole point of the single-dispatcher architecture
 * is that PII stays inside the dispatcher, never in stdout.
 *
 * ## notification_log.status invariants
 *
 * Enforced by CHECK constraint at the DB level (see migration
 * `20260409000000_notification_log_status_check.sql`):
 *
 *   - 'queued'  — row created, not yet sent. Used by Phase 4 24h expiry
 *                 flow (write queued → update booking → dispatch by log_id)
 *                 and Phase 5 admin retry flow.
 *   - 'sent'    — sendEmail returned 2xx, row is terminal.
 *   - 'failed'  — sendEmail returned error OR dispatcher crashed mid-flight,
 *                 row is terminal for this attempt. Admin can manually retry
 *                 within 7 days via /admin/notifications.
 *
 * Idempotency key: `(booking_id, notification_type)` where `status = 'sent'`.
 * A prior `failed` row does not block a retry; a prior `sent` row does.
 */

export type NotificationType =
  | 'booking_created'
  | 'booking_cancelled'
  | 'payment_reminder'
  | 'payment_expired'
  | 'ncn_raised'
  | 'np_raised'
  | 'completion_survey'

export type NotificationLogStatus = 'queued' | 'sent' | 'failed'

/**
 * The primary dispatcher input — a discriminated union keyed by `type`.
 * Most callers (EFs and server actions) use this shape.
 */
export type NotificationPayload =
  | { type: 'booking_created'; booking_id: string }
  | { type: 'booking_cancelled'; booking_id: string; reason?: string }
  | { type: 'payment_reminder'; booking_id: string }
  | { type: 'payment_expired'; booking_id: string }
  | { type: 'ncn_raised'; booking_id: string; ncn_id: string }
  | { type: 'np_raised'; booking_id: string; np_id: string }
  | { type: 'completion_survey'; booking_id: string; survey_token: string }

/**
 * Alternative input for the "resume a pre-existing queued row" path.
 *
 * Used by:
 *   - Phase 4 handle-expired-payments EF — writes a queued log row inside
 *     the same transaction as the booking status UPDATE, then invokes the
 *     dispatcher by log_id. This guarantees at-least-once delivery even if
 *     the send crashes after the status flip.
 *   - Phase 5 admin retry action — sets an existing failed row back to
 *     queued inside a SELECT FOR UPDATE lock, then invokes by log_id.
 */
export interface NotificationResumePayload {
  notification_log_id: string
}

export type NotificationDispatchInput =
  | NotificationPayload
  | NotificationResumePayload

/**
 * Dispatcher result. Never throws across the EF boundary — all failure
 * modes are encoded in the return value so callers can fire-and-forget
 * without breaking their own operation.
 */
export type DispatchResult =
  | { ok: true; skipped: true }
  | { ok: true; sent: true; log_id: string }
  | { ok: false; error: string; log_id?: string | undefined }

/**
 * Per-tenant branding fields used by the shared `_layout.ts` email wrapper.
 * Matches the subset of `client` columns the dispatcher loads.
 */
export interface ClientBranding {
  name: string
  logo_light_url: string | null
  primary_colour: string | null
  email_footer_html: string | null
}
