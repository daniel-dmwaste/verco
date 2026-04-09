import type {
  NotificationDispatchInput,
  DispatchResult,
} from './templates/types'

/**
 * Notification dispatcher — the single entry point for all transactional
 * email in Verco.
 *
 * ## Phase 0 skeleton
 *
 * This file is a target import for callers that will be wired up in later
 * phases. The real implementation lands in Phase 1 (VER-119):
 *
 *   1. Validate the `NotificationDispatchInput` via zod (handles both the
 *      discriminated union and the resume-by-log-id path)
 *   2. Short-circuit on idempotency: if `notification_log` already has a
 *      `status='sent'` row for `(booking_id, notification_type)`, return
 *      `{ ok: true, skipped: true }`
 *   3. Resolve booking → contact → client via a single service-role query
 *      (field callers pass only `booking_id`; PII access happens here)
 *   4. Short-circuit if booking not found — return clean error, write
 *      nothing to `notification_log` (avoids FK violation on `client_id`)
 *   5. Load type-specific extras (booking_item, NCN row, etc.)
 *   6. Render the appropriate template via `_layout.ts`
 *   7. Call `sendEmail` (SendGrid helper at `_shared/sendgrid.ts`)
 *   8. Write `notification_log` row (`sent` or `failed` with error)
 *   9. Emit structured log line per contract in `templates/types.ts`
 *
 * ## Mirror contract
 *
 * The Deno implementation lives at `supabase/functions/send-notification/
 * index.ts` (to be created in Phase 1). That file is NOT a line-for-line
 * mirror of this one — it's an HTTP wrapper around the same logic, written
 * as a standalone Edge Function. The pure template renderers under
 * `templates/` ARE line-for-line mirrors, enforced by the `template-sync`
 * CI job.
 */
export async function dispatch(
  _input: NotificationDispatchInput
): Promise<DispatchResult> {
  return {
    ok: false,
    error: 'dispatch() is a Phase 0 skeleton — implementation lands in VER-119 Phase 1',
  }
}
