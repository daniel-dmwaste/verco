# Phase 4 — Abandoned Cart Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add payment reminder (6h) and payment expired (24h) notification emails triggered by a new hourly cron Edge Function, including the resume-by-log-id dispatcher path for crash-safe expiry notifications.

**Architecture:** Two new templates follow the existing pattern. The dispatcher is extended with a resume-by-log-id path that operates on pre-existing `queued` notification_log rows (used by the 24h expiry flow for crash safety). A new `handle-expired-payments` cron EF queries for stale `Pending Payment` bookings and triggers notifications. A pg_cron migration schedules hourly execution.

**Tech Stack:** TypeScript, Vitest, Deno Edge Functions, Supabase pg_cron + pg_net, SendGrid

**Spec:** `docs/superpowers/specs/2026-04-13-notifications-phase4-abandoned-cart-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/notifications/dispatch.ts` | Modify:72-84, 104-110, 240-244 | Add deps + resume path + wire templates |
| `src/lib/notifications/templates/types.ts` | Modify | No change needed — types already exist |
| `src/lib/notifications/templates/payment-reminder.ts` | Create | Reminder template |
| `src/lib/notifications/templates/payment-expired.ts` | Create | Expired template |
| `src/__tests__/notifications/templates/payment-reminder.test.ts` | Create | Reminder tests |
| `src/__tests__/notifications/templates/payment-expired.test.ts` | Create | Expired tests |
| `src/__tests__/notifications/dispatch.test.ts` | Modify | Resume path + routing tests |
| `src/__tests__/notifications/fixtures.ts` | Modify:137-199 | Add resume-path mock deps |
| `src/__tests__/notifications/pii-leak.test.ts` | Modify | 2 new PII tests |
| `supabase/functions/_shared/dispatch.ts` | Modify | Mirror dispatcher |
| `supabase/functions/_shared/templates/payment-reminder.ts` | Create | Mirror |
| `supabase/functions/_shared/templates/payment-expired.ts` | Create | Mirror |
| `supabase/functions/send-notification/index.ts` | Modify | Wire new deps |
| `supabase/functions/handle-expired-payments/index.ts` | Create | Cron EF |
| `supabase/migrations/<ts>_schedule_handle_expired_payments.sql` | Create | Cron schedule |

---

### Task 1: Payment reminder template (TDD)

**Files:**
- Create: `src/__tests__/notifications/templates/payment-reminder.test.ts`
- Create: `src/lib/notifications/templates/payment-reminder.ts`
- Create: `supabase/functions/_shared/templates/payment-reminder.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/notifications/templates/payment-reminder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderPaymentReminder } from '@/lib/notifications/templates/payment-reminder'
import { makeMockBooking, makeMockPaidBooking } from '../fixtures'

const APP_URL = 'https://verco.test'

describe('renderPaymentReminder', () => {
  it('returns a subject containing the booking reference', () => {
    const booking = makeMockPaidBooking()
    const { subject } = renderPaymentReminder(booking, APP_URL)
    expect(subject).toContain(booking.ref)
    expect(subject).toContain('Complete your booking')
  })

  it('renders the amount due from total_charge_cents', () => {
    const booking = makeMockPaidBooking() // total_charge_cents = 5500
    const { html } = renderPaymentReminder(booking, APP_URL)
    expect(html).toContain('$55.00')
    expect(html).toContain('payment')
  })

  it('CTA links to the booking detail page', () => {
    const booking = makeMockPaidBooking()
    booking.client.slug = 'kwn'
    const { html } = renderPaymentReminder(booking, APP_URL)
    expect(html).toContain(`https://verco.test/kwn/booking/${encodeURIComponent(booking.ref)}`)
    expect(html).toContain('Complete payment')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/templates/payment-reminder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the template**

Create `src/lib/notifications/templates/payment-reminder.ts`:

```ts
import type { BookingForDispatch } from './types'
import { renderEmailLayout } from './_layout'
import type { RenderedEmail } from './booking-created'

function formatCurrency(cents: number): string {
  const dollars = cents / 100
  return dollars.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
  })
}

function formatCollectionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00+08:00`)
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderPaymentReminder(
  booking: BookingForDispatch,
  appUrl: string
): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  const bodyHtml = `
    <p style="margin:0 0 16px 0">You started a verge collection booking but haven't completed payment yet.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#293F52;font-size:13px;font-weight:600;border-top:1px solid #F0F2F5">Amount due</td><td style="padding:6px 0;color:#293F52;font-size:13px;font-weight:600;text-align:right;border-top:1px solid #F0F2F5">${formatCurrency(booking.total_charge_cents)}</td></tr>
    </table>
    <p style="margin:0 0 16px 0">Complete your payment to confirm the booking.</p>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/booking/${encodeURIComponent(ref)}`

  return {
    subject: `Complete your booking — ${ref}`,
    html: renderEmailLayout({
      client: booking.client,
      preheader: `You have an unpaid verge collection booking — ${ref}`,
      heading: 'Complete your booking',
      bodyHtml,
      ctaText: 'Complete payment',
      ctaUrl,
    }),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/templates/payment-reminder.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Mirror to Deno**

Copy to `supabase/functions/_shared/templates/payment-reminder.ts`. Update imports to `.ts` extensions:

```ts
import type { BookingForDispatch } from './types.ts'
import { renderEmailLayout } from './_layout.ts'
import type { RenderedEmail } from './booking-created.ts'
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/templates/payment-reminder.ts src/__tests__/notifications/templates/payment-reminder.test.ts supabase/functions/_shared/templates/payment-reminder.ts
git commit -m "feat(notifications): payment-reminder email template with TDD"
```

---

### Task 2: Payment expired template (TDD)

**Files:**
- Create: `src/__tests__/notifications/templates/payment-expired.test.ts`
- Create: `src/lib/notifications/templates/payment-expired.ts`
- Create: `supabase/functions/_shared/templates/payment-expired.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/notifications/templates/payment-expired.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderPaymentExpired } from '@/lib/notifications/templates/payment-expired'
import { makeMockPaidBooking } from '../fixtures'

const APP_URL = 'https://verco.test'

describe('renderPaymentExpired', () => {
  it('returns a subject containing the booking reference', () => {
    const booking = makeMockPaidBooking()
    const { subject } = renderPaymentExpired(booking, APP_URL)
    expect(subject).toContain(booking.ref)
    expect(subject).toContain('Booking expired')
  })

  it('renders the no-charge notice', () => {
    const booking = makeMockPaidBooking()
    const { html } = renderPaymentExpired(booking, APP_URL)
    expect(html).toContain('No charge has been made')
    expect(html).toContain('expired')
  })

  it('CTA links to the dashboard for rebooking', () => {
    const booking = makeMockPaidBooking()
    booking.client.slug = 'kwn'
    const { html } = renderPaymentExpired(booking, APP_URL)
    expect(html).toContain('https://verco.test/kwn/dashboard')
    expect(html).toContain('Book again')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/templates/payment-expired.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the template**

Create `src/lib/notifications/templates/payment-expired.ts`:

```ts
import type { BookingForDispatch } from './types'
import { renderEmailLayout } from './_layout'
import type { RenderedEmail } from './booking-created'

function formatCollectionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00+08:00`)
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderPaymentExpired(
  booking: BookingForDispatch,
  appUrl: string
): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  const bodyHtml = `
    <p style="margin:0 0 16px 0">Your verge collection booking has expired because payment wasn't completed within 24 hours.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
    </table>
    <p style="margin:0 0 16px 0">No charge has been made to your payment method.</p>
    <p style="margin:0 0 16px 0">You can book another collection any time.</p>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/dashboard`

  return {
    subject: `Booking expired — ${ref}`,
    html: renderEmailLayout({
      client: booking.client,
      preheader: `Your booking ${ref} has expired — no charge was made`,
      heading: 'Booking expired',
      bodyHtml,
      ctaText: 'Book again',
      ctaUrl,
    }),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/templates/payment-expired.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Mirror to Deno**

Copy to `supabase/functions/_shared/templates/payment-expired.ts`. Update imports to `.ts` extensions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/templates/payment-expired.ts src/__tests__/notifications/templates/payment-expired.test.ts supabase/functions/_shared/templates/payment-expired.ts
git commit -m "feat(notifications): payment-expired email template with TDD"
```

---

### Task 3: Expand DispatchDeps + mock factory for resume path

**Files:**
- Modify: `src/lib/notifications/dispatch.ts:72-84`
- Modify: `src/__tests__/notifications/fixtures.ts:137-199`
- Modify: `supabase/functions/_shared/dispatch.ts`

- [ ] **Step 1: Add two new deps to `DispatchDeps`**

In `src/lib/notifications/dispatch.ts`, add two new methods to the `DispatchDeps` interface (after line 84, before the closing `}`):

```ts
  /** Load a notification_log row by ID for the resume path. Returns null if not found. */
  loadNotificationLog: (id: string) => Promise<{
    booking_id: string
    notification_type: NotificationType
    status: 'queued' | 'sent' | 'failed'
    to_address: string
  } | null>
  /** Update an existing notification_log row's status (for the resume path). */
  updateLogStatus: (id: string, status: 'sent' | 'failed', errorMessage?: string, toAddress?: string) => Promise<void>
```

Also add the `NotificationLogStatus` import at the top of the file if not already imported — check the existing imports from `./templates/types`. It's already imported as a type but only used in `NotificationLogRow`. The `status` field in the return type above uses literal types directly, so no new import needed.

- [ ] **Step 2: Update the mock factory**

In `src/__tests__/notifications/fixtures.ts`, add to `MockDispatchState` (after line 152):

```ts
  /**
   * Queued notification_log rows for the resume-by-log-id path.
   * Keyed by log id.
   */
  queuedLogs?: Record<string, {
    booking_id: string
    notification_type: NotificationType
    status: 'queued' | 'sent' | 'failed'
    to_address: string
  }>
```

Add to `MockDispatchDeps` (after line 161):

```ts
  /** Spy on all updateLogStatus calls. */
  updateLogStatusMock: ReturnType<typeof vi.fn>
```

Update `createMockDispatchDeps` to add the two new deps. After the `sendEmail` assignment (line 176), add:

```ts
  const updateLogStatusMock = vi.fn(async () => {})
```

Add to the return object (after `sendEmailMock` on line 198):

```ts
    loadNotificationLog: async (id: string) => {
      return state.queuedLogs?.[id] ?? null
    },
    updateLogStatus: updateLogStatusMock,
    updateLogStatusMock,
```

- [ ] **Step 3: Mirror DispatchDeps to Deno**

Make the identical `DispatchDeps` changes in `supabase/functions/_shared/dispatch.ts`.

- [ ] **Step 4: Run type check**

Run: `pnpm tsc --noEmit`
Expected: FAIL — the `send-notification` EF creates a `DispatchDeps` object that now needs the two new props. This is expected and will be fixed in Task 6.

Note: If tsc fails on something OTHER than the send-notification EF, investigate. The fixtures and dispatch.ts should type-check independently.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/dispatch.ts src/__tests__/notifications/fixtures.ts supabase/functions/_shared/dispatch.ts
git commit -m "feat(notifications): expand DispatchDeps with loadNotificationLog + updateLogStatus"
```

---

### Task 4: Implement resume-by-log-id dispatcher path (TDD)

**Files:**
- Modify: `src/__tests__/notifications/dispatch.test.ts`
- Modify: `src/lib/notifications/dispatch.ts:104-110`
- Modify: `supabase/functions/_shared/dispatch.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/notifications/dispatch.test.ts`, inside the `describe('dispatch', ...)` block:

```ts
  describe('resume-by-log-id', () => {
    it('resumes a queued log row, sends email, and calls updateLogStatus with sent', async () => {
      const booking = makeMockBooking({ id: 'b-resume', total_charge_cents: 5500 })
      const deps = createMockDispatchDeps({
        bookings: { 'b-resume': booking },
        queuedLogs: {
          'log-queued-1': {
            booking_id: 'b-resume',
            notification_type: 'payment_expired',
            status: 'queued',
            to_address: 'pending',
          },
        },
      })

      const result = await dispatch(deps, { notification_log_id: 'log-queued-1' })

      expect(result).toMatchObject({ ok: true, sent: true })
      expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
      expect(deps.updateLogStatusMock).toHaveBeenCalledWith(
        'log-queued-1',
        'sent',
        undefined,
        booking.contact!.email
      )
    })

    it('returns error when log row is not found', async () => {
      const deps = createMockDispatchDeps({})

      const result = await dispatch(deps, { notification_log_id: 'nonexistent' })

      expect(result).toMatchObject({ ok: false })
      expect(result.ok === false && result.error).toContain('not found')
      expect(deps.sendEmailMock).not.toHaveBeenCalled()
    })

    it('skips when log row is already sent', async () => {
      const deps = createMockDispatchDeps({
        queuedLogs: {
          'log-already-sent': {
            booking_id: 'b-any',
            notification_type: 'payment_expired',
            status: 'sent',
            to_address: 'test@example.com',
          },
        },
      })

      const result = await dispatch(deps, { notification_log_id: 'log-already-sent' })

      expect(result).toEqual({ ok: true, skipped: true })
      expect(deps.sendEmailMock).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: 3 new tests FAIL — the stub still rejects resume payloads

- [ ] **Step 3: Implement the resume path**

In `src/lib/notifications/dispatch.ts`, replace lines 104-110:

```ts
  // Phase 4 will handle the resume-by-log-id variant. Phase 1 only supports
  // the primary payload variant.
  if ('notification_log_id' in input) {
    const error = 'Resume-by-log-id path lands in Phase 4 (VER-122)'
    log({ type: null, status: 'failed', error })
    return { ok: false, error }
  }
```

with:

```ts
  // Resume-by-log-id path — used by Phase 4 expiry flow and Phase 5 retry.
  // Loads an existing queued row, dispatches, then updates the same row.
  if ('notification_log_id' in input) {
    const logId = input.notification_log_id
    try {
      const logRow = await deps.loadNotificationLog(logId)
      if (!logRow) {
        const error = `Notification log row not found: ${logId}`
        log({ type: null, status: 'failed', error, sendgrid_status: null })
        return { ok: false, error }
      }
      if (logRow.status === 'sent') {
        log({ type: logRow.notification_type, booking_id: logRow.booking_id, status: 'skipped', sendgrid_status: null })
        return { ok: true, skipped: true }
      }

      const booking = await deps.loadBooking(logRow.booking_id)
      if (!booking) {
        const error = `Booking not found for log row ${logId}: ${logRow.booking_id}`
        log({ type: logRow.notification_type, booking_id: logRow.booking_id, status: 'failed', error, sendgrid_status: null })
        return { ok: false, error }
      }

      if (!booking.contact || !booking.contact.email) {
        const error = `Booking ${logRow.booking_id} has no contact email`
        await deps.updateLogStatus(logId, 'failed', error)
        log({ type: logRow.notification_type, booking_id: logRow.booking_id, status: 'failed', error, sendgrid_status: null })
        return { ok: false, error, log_id: logId }
      }

      // Construct a payload from the log row to reuse renderTemplate
      const syntheticPayload = { type: logRow.notification_type, booking_id: logRow.booking_id } as NotificationPayload

      let rendered: { subject: string; html: string }
      try {
        rendered = renderTemplate(syntheticPayload, booking, deps.appUrl)
      } catch (renderErr) {
        const error = renderErr instanceof Error ? renderErr.message : String(renderErr)
        await deps.updateLogStatus(logId, 'failed', `Template render failed: ${error}`)
        log({ type: logRow.notification_type, booking_id: logRow.booking_id, status: 'failed', error: `render: ${error}`, sendgrid_status: null })
        return { ok: false, error, log_id: logId }
      }

      const fromEmail = booking.client.reply_to_email ?? deps.defaultFromEmail
      const fromName = booking.client.email_from_name ?? booking.client.name
      const sendResult = await deps.sendEmail({
        to: { email: booking.contact.email, name: booking.contact.full_name },
        from: { email: fromEmail, name: fromName },
        subject: rendered.subject,
        htmlBody: rendered.html,
      })

      await deps.updateLogStatus(
        logId,
        sendResult.ok ? 'sent' : 'failed',
        sendResult.ok ? undefined : sendResult.error,
        booking.contact.email
      )

      log({
        type: logRow.notification_type,
        booking_id: logRow.booking_id,
        status: sendResult.ok ? 'sent' : 'failed',
        sendgrid_status: sendResult.ok ? 202 : ('status' in sendResult ? sendResult.status : null) ?? null,
        ...(sendResult.ok ? {} : { error: sendResult.error }),
      })

      if (sendResult.ok) {
        return { ok: true, sent: true, log_id: logId }
      }
      return { ok: false, error: sendResult.error, log_id: logId }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log({ type: null, status: 'failed', error: `crashed: ${error}`, sendgrid_status: null })
      return { ok: false, error }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Mirror to Deno**

Make the identical changes in `supabase/functions/_shared/dispatch.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/dispatch.ts src/__tests__/notifications/dispatch.test.ts supabase/functions/_shared/dispatch.ts
git commit -m "feat(notifications): implement resume-by-log-id dispatcher path"
```

---

### Task 5: Wire payment_reminder + payment_expired in dispatcher (TDD)

**Files:**
- Modify: `src/__tests__/notifications/dispatch.test.ts`
- Modify: `src/lib/notifications/dispatch.ts:1-25, 240-244`
- Modify: `supabase/functions/_shared/dispatch.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/notifications/dispatch.test.ts`:

```ts
  it('routes payment_reminder to the reminder template', async () => {
    const booking = makeMockBooking({ id: 'b-remind', total_charge_cents: 5500 })
    const deps = createMockDispatchDeps({ bookings: { 'b-remind': booking } })

    const result = await dispatch(deps, {
      type: 'payment_reminder',
      booking_id: 'b-remind',
    })

    expect(result).toMatchObject({ ok: true, sent: true })
    const emailCall = deps.sendEmailMock.mock.calls[0]?.[0] as { subject: string; htmlBody: string } | undefined
    expect(emailCall?.subject).toContain('Complete your booking')
    expect(emailCall?.htmlBody).toContain('$55.00')
  })

  it('routes payment_expired to the expired template', async () => {
    const booking = makeMockBooking({ id: 'b-expire', total_charge_cents: 5500 })
    const deps = createMockDispatchDeps({ bookings: { 'b-expire': booking } })

    const result = await dispatch(deps, {
      type: 'payment_expired',
      booking_id: 'b-expire',
    })

    expect(result).toMatchObject({ ok: true, sent: true })
    const emailCall = deps.sendEmailMock.mock.calls[0]?.[0] as { subject: string; htmlBody: string } | undefined
    expect(emailCall?.subject).toContain('Booking expired')
    expect(emailCall?.htmlBody).toContain('No charge has been made')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: 2 new tests FAIL — "Template not yet implemented"

- [ ] **Step 3: Add imports and wire the switch cases**

In `src/lib/notifications/dispatch.ts`, add imports after the existing template imports:

```ts
import { renderPaymentReminder } from './templates/payment-reminder'
import { renderPaymentExpired } from './templates/payment-expired'
```

Replace lines 240-244 (the `payment_reminder`/`payment_expired` throw block):

```ts
    case 'payment_reminder':
    case 'payment_expired':
      throw new Error(
        `Template not yet implemented for type: ${payload.type} (lands in later phase)`
      )
```

with:

```ts
    case 'payment_reminder':
      return renderPaymentReminder(booking, appUrl)
    case 'payment_expired':
      return renderPaymentExpired(booking, appUrl)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Mirror to Deno**

In `supabase/functions/_shared/dispatch.ts`, add imports (with `.ts` extensions) and make the same switch case changes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/dispatch.ts src/__tests__/notifications/dispatch.test.ts supabase/functions/_shared/dispatch.ts
git commit -m "feat(notifications): wire payment_reminder + payment_expired in dispatcher"
```

---

### Task 6: Wire new deps in send-notification EF

**Files:**
- Modify: `supabase/functions/send-notification/index.ts`

- [ ] **Step 1: Add `loadNotificationLog` dep**

In `supabase/functions/send-notification/index.ts`, add the new dep to the `DispatchDeps` object (in the `deps` const, after the `writeLog` implementation around line 322):

```ts
    loadNotificationLog: async (id: string) => {
      const { data, error } = await supabaseService
        .from('notification_log')
        .select('booking_id, notification_type, status, to_address')
        .eq('id', id)
        .maybeSingle()
      if (error || !data) return null
      return {
        booking_id: data.booking_id as string,
        notification_type: data.notification_type as NotificationType,
        status: data.status as 'queued' | 'sent' | 'failed',
        to_address: data.to_address as string,
      }
    },
```

- [ ] **Step 2: Add `updateLogStatus` dep**

Add after the `loadNotificationLog` implementation:

```ts
    updateLogStatus: async (
      id: string,
      status: 'sent' | 'failed',
      errorMessage?: string,
      toAddress?: string
    ) => {
      const updateData: Record<string, unknown> = { status }
      if (errorMessage !== undefined) updateData.error_message = errorMessage
      if (toAddress !== undefined) updateData.to_address = toAddress
      const { error } = await supabaseService
        .from('notification_log')
        .update(updateData)
        .eq('id', id)
      if (error) {
        console.error('updateLogStatus failed:', error.message)
      }
    },
```

- [ ] **Step 3: Add the `NotificationType` import**

The EF file already imports `NotificationType` from the dispatch module — verify this. If not, add it to the existing import.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-notification/index.ts
git commit -m "feat(notifications): wire loadNotificationLog + updateLogStatus in send-notification EF"
```

---

### Task 7: PII leak tests for payment templates

**Files:**
- Modify: `src/__tests__/notifications/pii-leak.test.ts`

- [ ] **Step 1: Add 2 new PII tests**

Add to the existing `describe('PII leak regression', ...)` block:

```ts
  it('payment_reminder template does not contain contact full_name, email, or mobile', async () => {
    const booking = makePiiLoadedBooking()
    const deps = createMockDispatchDeps({ bookings: { [booking.id]: booking } })

    await dispatch(deps, {
      type: 'payment_reminder',
      booking_id: booking.id,
    })

    expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
    const call = deps.sendEmailMock.mock.calls[0]![0]
    const html: string = call.htmlBody

    expect(html).not.toContain(PII_STRINGS.full_name)
    expect(html).not.toContain(PII_STRINGS.email)
    expect(html).not.toContain(PII_STRINGS.mobile_e164)
  })

  it('payment_expired template does not contain contact full_name, email, or mobile', async () => {
    const booking = makePiiLoadedBooking()
    const deps = createMockDispatchDeps({ bookings: { [booking.id]: booking } })

    await dispatch(deps, {
      type: 'payment_expired',
      booking_id: booking.id,
    })

    expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
    const call = deps.sendEmailMock.mock.calls[0]![0]
    const html: string = call.htmlBody

    expect(html).not.toContain(PII_STRINGS.full_name)
    expect(html).not.toContain(PII_STRINGS.email)
    expect(html).not.toContain(PII_STRINGS.mobile_e164)
  })
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/__tests__/notifications/pii-leak.test.ts`
Expected: All 7 tests PASS (5 existing + 2 new)

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/notifications/pii-leak.test.ts
git commit -m "test(notifications): PII leak regression for payment_reminder + payment_expired"
```

---

### Task 8: Create handle-expired-payments cron EF

**Files:**
- Create: `supabase/functions/handle-expired-payments/index.ts`

- [ ] **Step 1: Create the Edge Function**

Create `supabase/functions/handle-expired-payments/index.ts`:

```ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

/**
 * handle-expired-payments cron Edge Function
 *
 * Runs hourly via pg_cron. Service role only — no user context.
 *
 * Two queries:
 *   1. 6h reminder — fresh send for Pending Payment bookings > 6h old
 *      without a prior sent/queued reminder
 *   2. 24h expiry — safe-ordered cancel: insert queued log row, cancel
 *      booking, then dispatch by log_id (crash-safe)
 */

serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const results = {
    reminders_sent: 0,
    reminders_failed: 0,
    expired_cancelled: 0,
    expired_failed: 0,
  }

  try {
    // ── 1. 6h reminder ────────────────────────────────────────────────────
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

    const { data: reminderBookings, error: reminderError } = await supabase
      .rpc('get_pending_payment_bookings_for_reminder', { cutoff_time: sixHoursAgo })

    if (reminderError) {
      console.error('Reminder query error:', reminderError.message)
    }

    // Fallback: if the RPC doesn't exist yet, use a direct query
    const reminders = reminderBookings ?? []

    for (const booking of reminders as Array<{ id: string }>) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'payment_reminder',
            booking_id: booking.id,
          }),
        })
        if (res.ok) {
          results.reminders_sent++
        } else {
          results.reminders_failed++
          const body = await res.text().catch(() => '(no body)')
          console.error(`Reminder failed for ${booking.id}: ${body}`)
        }
      } catch (err) {
        results.reminders_failed++
        console.error(`Reminder crashed for ${booking.id}:`, err instanceof Error ? err.message : String(err))
      }
    }

    // ── 2. 24h expiry ─────────────────────────────────────────────────────
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: expiryBookings, error: expiryError } = await supabase
      .from('booking')
      .select('id, client_id, contact_id')
      .eq('status', 'Pending Payment')
      .lt('created_at', twentyFourHoursAgo)

    if (expiryError) {
      console.error('Expiry query error:', expiryError.message)
    }

    for (const booking of (expiryBookings ?? []) as Array<{ id: string; client_id: string; contact_id: string | null }>) {
      try {
        // Step 1: Insert queued notification_log row
        const { data: logRow, error: logError } = await supabase
          .from('notification_log')
          .insert({
            booking_id: booking.id,
            client_id: booking.client_id,
            contact_id: booking.contact_id,
            channel: 'email',
            notification_type: 'payment_expired',
            to_address: 'pending',
            status: 'queued',
          })
          .select('id')
          .single()

        if (logError || !logRow) {
          results.expired_failed++
          console.error(`Expiry log insert failed for ${booking.id}:`, logError?.message)
          continue
        }

        // Step 2: Cancel the booking
        const { error: cancelError } = await supabase
          .from('booking')
          .update({
            status: 'Cancelled',
            cancelled_at: new Date().toISOString(),
          })
          .eq('id', booking.id)

        if (cancelError) {
          results.expired_failed++
          console.error(`Expiry cancel failed for ${booking.id}:`, cancelError.message)
          // Log row is queued but booking not cancelled — manual cleanup needed
          continue
        }

        // Step 3: Dispatch by log_id (crash-safe — queued row persists if this fails)
        const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            notification_log_id: logRow.id,
          }),
        })

        if (res.ok) {
          results.expired_cancelled++
        } else {
          // Booking IS cancelled, log row stays queued for retry
          results.expired_cancelled++ // booking was still cancelled successfully
          const body = await res.text().catch(() => '(no body)')
          console.error(`Expiry notification failed for ${booking.id} (booking cancelled, email pending): ${body}`)
        }
      } catch (err) {
        results.expired_failed++
        console.error(`Expiry crashed for ${booking.id}:`, err instanceof Error ? err.message : String(err))
      }
    }

    console.log(JSON.stringify({ event: 'handle_expired_payments', ...results }))

    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('handle-expired-payments error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

- [ ] **Step 2: Create the 6h reminder RPC**

The cron uses a direct query for the 24h expiry (simple `WHERE` clause). For the 6h reminder, we need a `NOT EXISTS` subquery which is cleaner as an RPC. However, to keep this task simpler and avoid a migration, we'll use a direct query approach instead.

Replace the RPC call in the reminder section with a direct query:

```ts
    // Direct query: Pending Payment bookings older than 6h without a prior reminder
    const { data: reminderBookings, error: reminderError } = await supabase
      .from('booking')
      .select('id')
      .eq('status', 'Pending Payment')
      .lt('created_at', sixHoursAgo)

    if (reminderError) {
      console.error('Reminder query error:', reminderError.message)
    }

    // Filter out bookings that already have a sent/queued reminder
    const reminderCandidates: Array<{ id: string }> = []
    for (const booking of (reminderBookings ?? []) as Array<{ id: string }>) {
      const { data: existingLog } = await supabase
        .from('notification_log')
        .select('id')
        .eq('booking_id', booking.id)
        .eq('notification_type', 'payment_reminder')
        .in('status', ['queued', 'sent'])
        .limit(1)

      if (!existingLog || existingLog.length === 0) {
        reminderCandidates.push(booking)
      }
    }
```

Then use `reminderCandidates` instead of `reminders` in the loop.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/handle-expired-payments/index.ts
git commit -m "feat(notifications): handle-expired-payments cron Edge Function"
```

---

### Task 9: Cron schedule migration

**Files:**
- Create: `supabase/migrations/<timestamp>_schedule_handle_expired_payments.sql`

- [ ] **Step 1: Create the migration**

Run: `pnpm supabase migration new schedule_handle_expired_payments`

This creates an empty migration file. Add the schedule:

```sql
-- =============================================================================
-- pg_cron schedule: handle-expired-payments
-- Runs at :05 past every hour
-- Handles 6h payment reminders and 24h booking expiry
-- =============================================================================

SELECT cron.schedule(
  'handle-expired-payments',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/handle-expired-payments',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(notifications): pg_cron schedule for handle-expired-payments (hourly at :05)"
```

---

### Task 10: Full test suite + CI sync verification

**Files:**
- All test files from prior tasks

- [ ] **Step 1: Run the full notification test suite**

Run: `pnpm vitest run src/__tests__/notifications/`
Expected: All tests PASS

- [ ] **Step 2: Run CI template-sync diffs**

Run diffs for all synced files:

```bash
diff <(cat src/lib/notifications/templates/types.ts) <(cat supabase/functions/_shared/templates/types.ts)
diff <(cat src/lib/notifications/templates/payment-reminder.ts) <(cat supabase/functions/_shared/templates/payment-reminder.ts)
diff <(cat src/lib/notifications/templates/payment-expired.ts) <(cat supabase/functions/_shared/templates/payment-expired.ts)
diff <(cat src/lib/notifications/dispatch.ts) <(cat supabase/functions/_shared/dispatch.ts)
```

Expected: Import extension diffs only

- [ ] **Step 3: Run the full project type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit (if any fixups were needed)**

Only if prior steps required corrections.
