# Phase 2 — User-Initiated Cancellation Notifications

**Linear:** VER-120
**Branch:** `feature/notifications`
**Date:** 2026-04-13

## Summary

Wire `booking_cancelled` notification emails to the resident cancel path and add a "refund pending review" copy variant. The admin cancel path already fires notifications (Phase 1) but needs the refund status made explicit.

## Decision Record

- **Refund model:** Admin-authorised. Resident cancel creates a `refund_request` with status `Pending` but does NOT call `process-refund`. Staff approve refunds from the existing refunds page. Auto-trigger is a future roadmap item.
- **Refund status on payload, not derived from DB.** The caller knows whether it triggered the refund — no need for the dispatcher to query `refund_request`.

## Changes

### 1. Payload type — add `refund_status`

**Files:** `src/lib/notifications/templates/types.ts`, `supabase/functions/_shared/templates/types.ts`

Add `refund_status` to the `booking_cancelled` variant of `NotificationPayload`:

```ts
| { type: 'booking_cancelled'; booking_id: string; reason?: string; refund_status?: 'processed' | 'pending_review' }
```

### 2. Template — branch on `refund_status`

**Files:** `src/lib/notifications/templates/booking-cancelled.ts`, `supabase/functions/_shared/templates/booking-cancelled.ts`

Add `refund_status` to `RenderBookingCancelledOptions`:

```ts
export interface RenderBookingCancelledOptions {
  reason?: string | undefined
  refund_status?: 'processed' | 'pending_review' | undefined
}
```

Replace the current refund block logic (which checks `total_charge_cents > 0`) with a three-way branch:

| `refund_status` | `total_charge_cents` | Copy |
|---|---|---|
| `'processed'` | >0 | "A refund of $X has been processed to your original payment method. It should appear within 1-3 business days." |
| `'pending_review'` | >0 | "Your refund of $X will be reviewed by our team. We'll be in touch once it's processed." |
| undefined / absent | any | No refund mention (free booking or legacy call) |

This is backwards-compatible: existing calls without `refund_status` produce the same output as before for free bookings. For paid bookings without `refund_status`, no refund copy appears (safe default).

### 3. Dispatcher — forward `refund_status`

**Files:** `src/lib/notifications/dispatch.ts`, `supabase/functions/_shared/dispatch.ts`

In `renderTemplate`, pass `refund_status` through to `RenderBookingCancelledOptions`:

```ts
case 'booking_cancelled': {
  const opts: RenderBookingCancelledOptions = {
    reason: payload.reason,
    refund_status: payload.refund_status,
  }
  return renderBookingCancelled(booking, appUrl, opts)
}
```

### 4. Resident cancel action — add refund request + notification

**File:** `src/app/(public)/booking/[ref]/actions.ts`

After the status update in `cancelBooking`:

1. Query `booking_item` for paid extras (same pattern as admin cancel)
2. If paid items exist, insert `refund_request` with `status: 'Pending'`, `reason: 'Booking cancelled by resident'`
3. Fire `send-notification` with `{ type: 'booking_cancelled', booking_id, refund_status: refundAmountCents > 0 ? 'pending_review' : undefined }`

Reuse the `invokeSendNotification` helper pattern from the admin actions file. The resident action uses the user's own JWT (RLS-scoped) — the EF accepts this per the dual-auth model.

### 5. Admin cancel action — pass `refund_status: 'processed'`

**File:** `src/app/(admin)/admin/bookings/[id]/actions.ts`

Update the existing `invokeSendNotification` call at line 168 to include:

```ts
refund_status: refundAmountCents > 0 ? 'processed' : undefined,
```

Update the `invokeSendNotification` helper's payload type to accept `refund_status`.

### 6. Tests

**Template tests** (`src/__tests__/notifications/templates/booking-cancelled.test.ts`):
- Add: "renders pending review copy when refund_status is pending_review"
- Add: "omits refund copy when paid booking has no refund_status (backwards compat)"
- Existing tests updated: paid booking test passes `refund_status: 'processed'` to match new explicit behaviour

**Dispatch tests** (`src/__tests__/notifications/dispatch.test.ts`):
- Add: "forwards refund_status to booking_cancelled template"

### 7. Deno mirror sync

All changes to `src/lib/notifications/` must be mirrored to `supabase/functions/_shared/`. CI template-sync guard enforces this.

## Files touched

| File | Change |
|---|---|
| `src/lib/notifications/templates/types.ts` | Add `refund_status` to payload |
| `src/lib/notifications/templates/booking-cancelled.ts` | Three-way refund block |
| `src/lib/notifications/dispatch.ts` | Forward `refund_status` |
| `src/app/(public)/booking/[ref]/actions.ts` | Add refund_request + notification |
| `src/app/(admin)/admin/bookings/[id]/actions.ts` | Pass `refund_status: 'processed'` |
| `supabase/functions/_shared/templates/types.ts` | Mirror types |
| `supabase/functions/_shared/templates/booking-cancelled.ts` | Mirror template |
| `supabase/functions/_shared/dispatch.ts` | Mirror dispatcher |
| `src/__tests__/notifications/templates/booking-cancelled.test.ts` | New + updated tests |
| `src/__tests__/notifications/dispatch.test.ts` | New test |

## Out of scope

- Abandoned-cart expiry (`payment_expired`) — Phase 4
- Admin cancel reason prompt in UI — email-only project
- Auto-refund on resident cancel — future roadmap item
- SMS channel — email only for MVP
