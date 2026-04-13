# Phase 2 — Cancellation Notification Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `booking_cancelled` notification emails to the resident cancel path with a "refund pending review" copy variant, and make the admin cancel path explicit about refund status.

**Architecture:** Add `refund_status` to the `booking_cancelled` payload variant. The template branches on it to show "processed", "pending review", or no refund copy. The resident cancel server action gets refund_request creation + notification dispatch. All changes mirror between Node (`src/lib/`) and Deno (`supabase/functions/_shared/`).

**Tech Stack:** TypeScript, Vitest, Next.js server actions, Supabase Edge Functions, SendGrid

**Spec:** `docs/superpowers/specs/2026-04-13-notifications-phase2-cancellations-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/notifications/templates/types.ts` | Modify:66 | Add `refund_status` to payload |
| `src/lib/notifications/templates/booking-cancelled.ts` | Modify:59-108 | Three-way refund block |
| `src/lib/notifications/dispatch.ts` | Modify:224-228 | Forward `refund_status` |
| `src/__tests__/notifications/templates/booking-cancelled.test.ts` | Modify | Add pending_review + backwards-compat tests |
| `src/__tests__/notifications/dispatch.test.ts` | Modify | Add refund_status forwarding test |
| `src/app/(public)/booking/[ref]/actions.ts` | Modify:14-83 | Add refund_request + notification |
| `src/app/(admin)/admin/bookings/[id]/actions.ts` | Modify:168-173, 195-199 | Pass `refund_status`, widen helper type |
| `supabase/functions/_shared/templates/types.ts` | Modify:66 | Mirror types |
| `supabase/functions/_shared/templates/booking-cancelled.ts` | Modify:59-108 | Mirror template |
| `supabase/functions/_shared/dispatch.ts` | Modify:224-228 | Mirror dispatcher |
| `supabase/functions/send-notification/index.ts` | Modify:93-100 | Add `resident` to permitted roles |

---

### Task 1: Add `refund_status` to payload type (Node + Deno)

**Files:**
- Modify: `src/lib/notifications/templates/types.ts:66`
- Modify: `supabase/functions/_shared/templates/types.ts:66`

- [ ] **Step 1: Update the Node payload type**

In `src/lib/notifications/templates/types.ts`, replace line 66:

```ts
  | { type: 'booking_cancelled'; booking_id: string; reason?: string }
```

with:

```ts
  | { type: 'booking_cancelled'; booking_id: string; reason?: string; refund_status?: 'processed' | 'pending_review' }
```

- [ ] **Step 2: Mirror to Deno**

In `supabase/functions/_shared/templates/types.ts`, make the identical change on line 66.

- [ ] **Step 3: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS (no consumers reference the new field yet)

- [ ] **Step 4: Commit**

```bash
git add src/lib/notifications/templates/types.ts supabase/functions/_shared/templates/types.ts
git commit -m "feat(notifications): add refund_status to booking_cancelled payload type"
```

---

### Task 2: Update template — three-way refund block (TDD)

**Files:**
- Modify: `src/__tests__/notifications/templates/booking-cancelled.test.ts`
- Modify: `src/lib/notifications/templates/booking-cancelled.ts:59-108`
- Modify: `supabase/functions/_shared/templates/booking-cancelled.ts:59-108`

- [ ] **Step 1: Write the failing tests**

Add three new tests and update one existing test in `src/__tests__/notifications/templates/booking-cancelled.test.ts`:

```ts
  it('renders "pending review" copy when refund_status is pending_review on a paid booking', () => {
    const booking = makeMockPaidBooking()
    const { html } = renderBookingCancelled(booking, APP_URL, {
      refund_status: 'pending_review',
    })
    expect(html).toContain('reviewed by our team')
    expect(html).toContain('$55.00')
    expect(html).not.toContain('has been processed')
  })

  it('renders "processed" copy when refund_status is processed on a paid booking', () => {
    const booking = makeMockPaidBooking()
    const { html } = renderBookingCancelled(booking, APP_URL, {
      refund_status: 'processed',
    })
    expect(html).toContain('has been processed')
    expect(html).toContain('$55.00')
    expect(html).not.toContain('reviewed by our team')
  })

  it('omits refund copy when paid booking has no refund_status (backwards compat)', () => {
    const booking = makeMockPaidBooking()
    const { html } = renderBookingCancelled(booking, APP_URL)
    expect(html).not.toContain('refund of')
    expect(html).not.toContain('reviewed by our team')
    expect(html).not.toContain('has been processed')
  })
```

Also update the existing "renders a refund notice when the booking had paid extras" test to pass `refund_status: 'processed'` (since refund copy now requires an explicit status):

```ts
  it('renders a refund notice when the booking had paid extras', () => {
    const booking = makeMockPaidBooking()
    const { html } = renderBookingCancelled(booking, APP_URL, {
      refund_status: 'processed',
    })
    expect(html).toContain('refund of')
    expect(html).toContain('$55.00')
    expect(html).toContain('1–3 business days')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/templates/booking-cancelled.test.ts`
Expected: 3 new tests FAIL (pending_review copy not rendered, processed not gated on refund_status). The updated existing test also FAILS (refund copy still renders without refund_status).

- [ ] **Step 3: Update `RenderBookingCancelledOptions` and refund block**

In `src/lib/notifications/templates/booking-cancelled.ts`, update the options interface and refund block:

Replace the `RenderBookingCancelledOptions` interface (line 59-62):

```ts
export interface RenderBookingCancelledOptions {
  /** Optional cancellation reason — shown in body if set */
  reason?: string | undefined
  /** Refund status — controls which refund copy variant appears */
  refund_status?: 'processed' | 'pending_review' | undefined
}
```

Replace the `refundBlock` logic (lines 78-82). The current code is:

```ts
  const refundBlock =
    refundAmount > 0
      ? `<p style="margin:0 0 16px 0">A refund of <strong>${formatCurrency(refundAmount)}</strong> has been processed to your original payment method. It should appear within 1–3 business days.</p>`
      : ''
```

Replace with:

```ts
  let refundBlock = ''
  if (refundAmount > 0 && options.refund_status === 'processed') {
    refundBlock = `<p style="margin:0 0 16px 0">A refund of <strong>${formatCurrency(refundAmount)}</strong> has been processed to your original payment method. It should appear within 1–3 business days.</p>`
  } else if (refundAmount > 0 && options.refund_status === 'pending_review') {
    refundBlock = `<p style="margin:0 0 16px 0">Your refund of <strong>${formatCurrency(refundAmount)}</strong> will be reviewed by our team. We'll be in touch once it's processed.</p>`
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/templates/booking-cancelled.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Mirror to Deno**

Copy the identical changes (interface + refund block) to `supabase/functions/_shared/templates/booking-cancelled.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/templates/booking-cancelled.ts src/__tests__/notifications/templates/booking-cancelled.test.ts supabase/functions/_shared/templates/booking-cancelled.ts
git commit -m "feat(notifications): three-way refund block — processed, pending_review, none"
```

---

### Task 3: Forward `refund_status` in dispatcher (TDD)

**Files:**
- Modify: `src/__tests__/notifications/dispatch.test.ts`
- Modify: `src/lib/notifications/dispatch.ts:224-228`
- Modify: `supabase/functions/_shared/dispatch.ts:224-228`

- [ ] **Step 1: Write the failing test**

Add a test to `src/__tests__/notifications/dispatch.test.ts` inside the existing `describe('dispatch', ...)` block. Place it after the existing booking_cancelled tests (or add a new `describe('booking_cancelled')` sub-block):

```ts
  it('forwards refund_status to booking_cancelled template', async () => {
    const booking = makeMockBooking({ id: 'b-refund', total_charge_cents: 5500 })
    const deps = createMockDispatchDeps({ bookings: { 'b-refund': booking } })

    const result = await dispatch(deps, {
      type: 'booking_cancelled',
      booking_id: 'b-refund',
      refund_status: 'pending_review',
    })

    expect(result).toMatchObject({ ok: true, sent: true })
    // Verify the email body contains the "pending review" copy
    const emailCall = deps.sendEmailMock.mock.calls[0]?.[0] as { htmlBody: string } | undefined
    expect(emailCall?.htmlBody).toContain('reviewed by our team')
    expect(emailCall?.htmlBody).not.toContain('has been processed')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: New test FAILS — `refund_status` not forwarded yet, so the template renders no refund block at all.

- [ ] **Step 3: Update renderTemplate in the dispatcher**

In `src/lib/notifications/dispatch.ts`, replace lines 224-228:

```ts
    case 'booking_cancelled': {
      const opts: RenderBookingCancelledOptions = {
        reason: payload.reason,
      }
      return renderBookingCancelled(booking, appUrl, opts)
    }
```

with:

```ts
    case 'booking_cancelled': {
      const opts: RenderBookingCancelledOptions = {
        reason: payload.reason,
        refund_status: payload.refund_status,
      }
      return renderBookingCancelled(booking, appUrl, opts)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Mirror to Deno**

Make the identical change in `supabase/functions/_shared/dispatch.ts` (same lines — add `refund_status: payload.refund_status` to the opts object).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/dispatch.ts src/__tests__/notifications/dispatch.test.ts supabase/functions/_shared/dispatch.ts
git commit -m "feat(notifications): forward refund_status through dispatcher to template"
```

---

### Task 4: Admin cancel — pass explicit `refund_status`

**Files:**
- Modify: `src/app/(admin)/admin/bookings/[id]/actions.ts:168-173, 195-199`

- [ ] **Step 1: Update the `invokeSendNotification` call to pass `refund_status`**

In `src/app/(admin)/admin/bookings/[id]/actions.ts`, replace the notification call at lines 168-173:

```ts
  await invokeSendNotification(supabase, {
    type: 'booking_cancelled',
    booking_id: bookingId,
    // No reason field captured in the admin UI yet — Phase 2 (VER-120)
    // may add a reason prompt to the cancel dialog.
  })
```

with:

```ts
  await invokeSendNotification(supabase, {
    type: 'booking_cancelled',
    booking_id: bookingId,
    refund_status: refundAmountCents > 0 ? 'processed' : undefined,
  })
```

- [ ] **Step 2: Widen the `invokeSendNotification` payload type**

In the same file, update the helper's payload type (lines 197-201) from:

```ts
  payload: {
    type: 'booking_created' | 'booking_cancelled'
    booking_id: string
    reason?: string
  }
```

to:

```ts
  payload: {
    type: 'booking_created' | 'booking_cancelled'
    booking_id: string
    reason?: string
    refund_status?: 'processed' | 'pending_review'
  }
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/(admin)/admin/bookings/[id]/actions.ts
git commit -m "feat(notifications): admin cancel passes refund_status to send-notification"
```

---

### Task 5: Add `resident` to EF permitted roles

**Files:**
- Modify: `supabase/functions/send-notification/index.ts:93-100`

The `send-notification` EF validates the caller's role against a permitted set. The current set includes staff and field roles but NOT `resident`. The resident cancel server action passes the resident's JWT, so this will 401 without the fix.

- [ ] **Step 1: Add `resident` to `PERMITTED_USER_ROLES`**

In `supabase/functions/send-notification/index.ts`, replace lines 93-100:

```ts
  const PERMITTED_USER_ROLES = new Set([
    'contractor-admin',
    'contractor-staff',
    'client-admin',
    'client-staff',
    'field',
    'ranger',
  ])
```

with:

```ts
  const PERMITTED_USER_ROLES = new Set([
    'contractor-admin',
    'contractor-staff',
    'client-admin',
    'client-staff',
    'field',
    'ranger',
    'resident',
  ])
```

- [ ] **Step 2: Update the EF doc comment**

In the same file, update the comment at line 49-52 to include `resident`:

Replace:

```ts
 * Permitted user roles: contractor-admin, contractor-staff, client-admin,
 * client-staff, field, ranger. (Residents cannot directly invoke the EF —
 * resident cancels go through a server action that the user is already
 * authenticated for, and the server action's role check happens upstream.)
```

with:

```ts
 * Permitted user roles: contractor-admin, contractor-staff, client-admin,
 * client-staff, field, ranger, resident. Resident callers are server
 * actions (e.g. resident cancel) that pass the user's own JWT.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-notification/index.ts
git commit -m "feat(notifications): add resident to send-notification EF permitted roles"
```

---

### Task 6: Resident cancel — add refund_request + notification

**Files:**
- Modify: `src/app/(public)/booking/[ref]/actions.ts:14-83`

- [ ] **Step 1: Widen the booking query to include refund fields**

In `src/app/(public)/booking/[ref]/actions.ts`, replace the `.select()` on line 24-25:

```ts
      'id, status, booking_item(collection_date!inner(date))'
```

with:

```ts
      'id, status, contact_id, client_id, booking_item(unit_price_cents, no_services, is_extra, collection_date!inner(date))'
```

And update the items type cast on line 44-46 from:

```ts
  const items = booking.booking_item as Array<{
    collection_date: { date: string }
  }>
```

to:

```ts
  const items = booking.booking_item as Array<{
    unit_price_cents: number
    no_services: number
    is_extra: boolean
    collection_date: { date: string }
  }>
```

- [ ] **Step 2: Add refund_request creation + notification after the status update**

After the status update block (after line 80 — `return { ok: false, error: updateError.message }`), and before the final `return { ok: true, data: undefined }`, add:

```ts
  // If booking has paid extras, create a pending refund_request for admin review
  const paidItems = items.filter((i) => i.is_extra && i.unit_price_cents > 0)
  const refundAmountCents = paidItems.reduce(
    (sum, i) => sum + i.unit_price_cents * i.no_services,
    0
  )

  if (refundAmountCents > 0 && booking.contact_id && booking.client_id) {
    const { error: refundInsertError } = await supabase
      .from('refund_request')
      .insert({
        booking_id: booking.id,
        contact_id: booking.contact_id,
        client_id: booking.client_id,
        amount_cents: refundAmountCents,
        reason: 'Booking cancelled by resident',
        status: 'Pending',
      })

    if (refundInsertError) {
      console.error(
        'Failed to create refund_request for resident-cancelled booking:',
        refundInsertError.message
      )
    }
  }

  // Fire booking_cancelled notification — fire-and-forget
  await invokeSendNotification(supabase, {
    type: 'booking_cancelled',
    booking_id: bookingId,
    refund_status: refundAmountCents > 0 ? 'pending_review' : undefined,
  })

  return { ok: true, data: undefined }
```

Remove the existing `return { ok: true, data: undefined }` on line 82 (replaced above).

- [ ] **Step 3: Add the `invokeSendNotification` helper to this file**

Add the helper at the bottom of the file (after the `disputeNp` function). This follows the same pattern as the admin actions file:

```ts
/**
 * Fire-and-forget POST to the send-notification Edge Function.
 *
 * Uses the user's session access token (not service role — CLAUDE.md §20).
 * The EF accepts user JWTs and validates the role before dispatching.
 */
async function invokeSendNotification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: {
    type: 'booking_cancelled'
    booking_id: string
    reason?: string
    refund_status?: 'processed' | 'pending_review'
  }
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
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      console.error(
        `[notifications] send-notification returned ${res.status} for ${payload.type} ${payload.booking_id}: ${body}`
      )
    }
  } catch (err) {
    console.error(
      `[notifications] Failed to invoke send-notification for ${payload.type} ${payload.booking_id}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}
```

- [ ] **Step 4: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/(public)/booking/[ref]/actions.ts
git commit -m "feat(notifications): resident cancel creates refund_request + fires booking_cancelled email"
```

---

### Task 7: Full test suite + CI sync verification

**Files:**
- All test files already modified in prior tasks

- [ ] **Step 1: Run the full notification test suite**

Run: `pnpm vitest run src/__tests__/notifications/`
Expected: All tests PASS (template tests, dispatch tests, PII-leak test)

- [ ] **Step 2: Run the CI template-sync check**

Run: `diff <(cat src/lib/notifications/templates/types.ts) <(cat supabase/functions/_shared/templates/types.ts)`
Expected: No diff (files are identical)

Run: `diff <(cat src/lib/notifications/templates/booking-cancelled.ts) <(cat supabase/functions/_shared/templates/booking-cancelled.ts)`
Expected: No diff

Run: `diff <(cat src/lib/notifications/dispatch.ts) <(cat supabase/functions/_shared/dispatch.ts)`
Expected: No diff

- [ ] **Step 3: Run the full project type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit (if any fixups were needed)**

Only if prior steps required corrections — otherwise skip.

```bash
git commit -m "fix(notifications): fixups from full test run"
```
