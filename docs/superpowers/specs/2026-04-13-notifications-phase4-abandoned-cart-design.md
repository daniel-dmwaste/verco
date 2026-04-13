# Phase 4 — Abandoned Cart Recovery (payment_reminder + payment_expired)

**Linear:** VER-122
**Branch:** `feature/notifications`
**Date:** 2026-04-13

## Summary

Two new notification types and a cron Edge Function. Residents who start a booking but don't complete payment get a reminder at 6 hours and an expiry notice at 24 hours when the booking is auto-cancelled.

## Decision Record

- **Payment reminder CTA links to booking detail page**, not a fresh Stripe checkout URL. The booking detail page already has a "Pay now" button that calls `create-checkout` (which handles expired sessions). This keeps the cron EF decoupled from Stripe.
- **24h expiry uses safe ordering** per the tech review: insert a `queued` notification_log row BEFORE cancelling the booking, then dispatch by `notification_log_id`. If the dispatch crashes, the queued row stays for manual retry (Phase 5).
- **6h reminder uses standard ordering** — it's a fresh send with no prior status change, so the normal create-new-row path works fine.

## Changes

### 1. Payment reminder template

**Files:** `src/lib/notifications/templates/payment-reminder.ts`, `supabase/functions/_shared/templates/payment-reminder.ts`

No options interface needed — uses `BookingForDispatch` directly.

Content:
- Subject: `Complete your booking — {ref}`
- Preheader: `You have an unpaid verge collection booking — {ref}`
- Heading: `Complete your booking`
- Body:
  - "You started a verge collection booking but haven't completed payment yet."
  - Details table: ref, collection date, address
  - Amount line: "Amount due: {total_charge_cents formatted}"
  - "Complete your payment to confirm the booking."
- CTA: "Complete payment" → `{appUrl}/{client_slug}/booking/{ref}`

### 2. Payment expired template

**Files:** `src/lib/notifications/templates/payment-expired.ts`, `supabase/functions/_shared/templates/payment-expired.ts`

Content:
- Subject: `Booking expired — {ref}`
- Preheader: `Your booking {ref} has expired — no charge was made`
- Heading: `Booking expired`
- Body:
  - "Your verge collection booking has expired because payment wasn't completed within 24 hours."
  - Details table: ref, collection date, address
  - "No charge has been made to your payment method."
  - "You can book another collection any time."
- CTA: "Book again" → `{appUrl}/{client_slug}/dashboard`

### 3. Dispatcher — resume-by-log-id path

**Files:** `src/lib/notifications/dispatch.ts`, `supabase/functions/_shared/dispatch.ts`

Replace the stub at lines 104-110 with the full resume path:

1. Call `deps.loadNotificationLog(input.notification_log_id)` — returns the row or null
2. Validate: row must exist, status must be `queued`
3. Extract `booking_id` and `notification_type` from the row
4. Load booking via `deps.loadBooking(booking_id)`
5. Construct a `NotificationPayload` from the row's `notification_type` and `booking_id`
6. Render template via existing `renderTemplate`
7. Send email
8. Call `deps.updateLogStatus(id, 'sent')` or `deps.updateLogStatus(id, 'failed', error)`
9. Return `DispatchResult`

**No new notification_log row is created** — the resume path updates the existing queued row.

### 4. DispatchDeps expansion

**Files:** `src/lib/notifications/dispatch.ts`, `supabase/functions/_shared/dispatch.ts`, `src/lib/notifications/templates/types.ts`, `supabase/functions/_shared/templates/types.ts`

Add to `DispatchDeps`:

```ts
loadNotificationLog: (id: string) => Promise<{ booking_id: string; notification_type: NotificationType; status: NotificationLogStatus; to_address: string } | null>
updateLogStatus: (id: string, status: 'sent' | 'failed', errorMessage?: string, toAddress?: string) => Promise<void>
```

The test mock factory (`createMockDispatchDeps`) gets matching stubs.

### 5. Dispatcher — wire payment_reminder and payment_expired in renderTemplate

Replace the `payment_reminder` / `payment_expired` throw stubs with real render calls:

```ts
case 'payment_reminder':
  return renderPaymentReminder(booking, appUrl)
case 'payment_expired':
  return renderPaymentExpired(booking, appUrl)
```

### 6. Cron EF — `handle-expired-payments`

**File:** `supabase/functions/handle-expired-payments/index.ts`

Service role only. Follows `auto-close-notices` pattern.

**6h reminder query:**
```sql
SELECT id, client_id FROM booking
WHERE status = 'Pending Payment'
  AND created_at < NOW() - INTERVAL '6 hours'
  AND NOT EXISTS (
    SELECT 1 FROM notification_log
    WHERE booking_id = booking.id
      AND notification_type = 'payment_reminder'
      AND status IN ('queued', 'sent')
  )
```
For each match: POST to `send-notification` with `{ type: 'payment_reminder', booking_id }` using service role bearer.

**24h expiry query:**
```sql
SELECT id, client_id, contact_id FROM booking
WHERE status = 'Pending Payment'
  AND created_at < NOW() - INTERVAL '24 hours'
```
For each match:
1. Insert `notification_log` with `status: 'queued'`, `notification_type: 'payment_expired'`, `channel: 'email'`, `to_address: 'pending'`
2. Update `booking.status = 'Cancelled'`, `booking.cancelled_at = now()`
3. POST to `send-notification` with `{ notification_log_id }` using service role bearer

The `to_address: 'pending'` is a placeholder — the dispatcher resolves the real email when it loads the contact via `loadBooking`, then updates the row's `to_address` via `updateLogStatus` (which also sets status and error). This ensures the log row has the correct email even if inserted before the contact was resolved.

**Idempotency:** The 6h query's `NOT EXISTS` on notification_log prevents double-sends. The 24h query only selects `Pending Payment` bookings — once cancelled, they won't appear again.

**Structured logging:** One JSON line per booking processed, per the existing convention.

### 7. Cron schedule migration

**File:** `supabase/migrations/<timestamp>_schedule_handle_expired_payments.sql`

```sql
SELECT cron.schedule(
  'handle-expired-payments',
  '5 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/handle-expired-payments',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ); $$
);
```

### 8. Send-notification EF — wire loadNotificationLog and updateLogStatus deps

**File:** `supabase/functions/send-notification/index.ts`

Add the two new deps to the `DispatchDeps` wiring:

- `loadNotificationLog`: query `notification_log` by ID with service role
- `updateLogStatus`: update `notification_log.status` and `error_message` by ID

### 9. Tests

**Template tests:**
- `payment-reminder.test.ts` (3): subject, amount due copy, CTA links to booking page
- `payment-expired.test.ts` (3): subject, no-charge notice, CTA links to dashboard

**Dispatch tests:**
- Resume path happy: queued row → loads booking → sends → updates to sent
- Resume path not found: returns error
- Resume path not queued (already sent): returns skipped
- payment_reminder routes to template
- payment_expired routes to template

**PII leak tests:**
- 2 new tests for payment_reminder and payment_expired

**Fixture updates:**
- `createMockDispatchDeps` adds `loadNotificationLog` and `updateLogStatus` mocks

## Files touched

| File | Action | Responsibility |
|---|---|---|
| `src/lib/notifications/templates/payment-reminder.ts` | Create | Reminder template |
| `src/lib/notifications/templates/payment-expired.ts` | Create | Expired template |
| `src/lib/notifications/dispatch.ts` | Modify | Resume path + wire templates |
| `src/lib/notifications/templates/types.ts` | Modify | Expand DispatchDeps |
| `src/__tests__/notifications/templates/payment-reminder.test.ts` | Create | Reminder tests |
| `src/__tests__/notifications/templates/payment-expired.test.ts` | Create | Expired tests |
| `src/__tests__/notifications/dispatch.test.ts` | Modify | Resume path + routing tests |
| `src/__tests__/notifications/fixtures.ts` | Modify | New mock deps |
| `src/__tests__/notifications/pii-leak.test.ts` | Modify | 2 new PII tests |
| `supabase/functions/_shared/templates/payment-reminder.ts` | Create | Mirror |
| `supabase/functions/_shared/templates/payment-expired.ts` | Create | Mirror |
| `supabase/functions/_shared/dispatch.ts` | Modify | Mirror dispatcher |
| `supabase/functions/_shared/templates/types.ts` | Modify | Mirror types |
| `supabase/functions/send-notification/index.ts` | Modify | Wire new deps |
| `supabase/functions/handle-expired-payments/index.ts` | Create | Cron EF |
| `supabase/migrations/<ts>_schedule_handle_expired_payments.sql` | Create | Cron schedule |

## Out of scope

- Automatic retry of failed reminders (cron runs hourly, idempotency handles it)
- Push notifications
- Admin failures page + manual retry (Phase 5)
- Stripe session creation in cron (uses booking detail page CTA instead)
