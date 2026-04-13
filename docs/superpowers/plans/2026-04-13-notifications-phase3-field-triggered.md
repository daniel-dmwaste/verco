# Phase 3 — Field-Triggered Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire NCN raised, Nothing Presented raised, and completion survey notification emails to field server actions, activating the existing survey frontend with real traffic.

**Architecture:** Three new email templates follow the existing pattern (pure functions taking `BookingForDispatch` + options, returning `{ subject, html }`). Field actions pass NCN/NP metadata on the payload (no extra DB queries in the dispatcher). Survey token is generated in the server action and the `booking_survey` row is created before the notification fires.

**Tech Stack:** TypeScript, Vitest, Next.js server actions, Supabase Edge Functions, SendGrid

**Spec:** `docs/superpowers/specs/2026-04-13-notifications-phase3-field-triggered-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/notifications/templates/types.ts` | Modify:69-71 | Expand payload variants |
| `src/lib/notifications/templates/ncn-raised.ts` | Create | NCN template |
| `src/lib/notifications/templates/np-raised.ts` | Create | NP template |
| `src/lib/notifications/templates/completion-survey.ts` | Create | Survey template |
| `src/lib/notifications/dispatch.ts` | Modify:1-15, 231-238 | Import + render 3 new cases |
| `src/app/(field)/field/booking/[ref]/actions.ts` | Modify:53-80, 111-138, 174-195 | Wire notifications |
| `supabase/functions/_shared/templates/types.ts` | Modify:69-71 | Mirror types |
| `supabase/functions/_shared/templates/ncn-raised.ts` | Create | Mirror NCN |
| `supabase/functions/_shared/templates/np-raised.ts` | Create | Mirror NP |
| `supabase/functions/_shared/templates/completion-survey.ts` | Create | Mirror survey |
| `supabase/functions/_shared/dispatch.ts` | Modify | Mirror dispatcher |
| `src/__tests__/notifications/templates/ncn-raised.test.ts` | Create | NCN tests |
| `src/__tests__/notifications/templates/np-raised.test.ts` | Create | NP tests |
| `src/__tests__/notifications/templates/completion-survey.test.ts` | Create | Survey tests |
| `src/__tests__/notifications/dispatch.test.ts` | Modify | 3 routing tests |
| `src/__tests__/notifications/pii-leak.test.ts` | Modify | Cover 3 new types |
| `src/__tests__/notifications/fixtures.ts` | Modify | Add NCN/NP mock bookings |

---

### Task 1: Expand payload types (Node + Deno)

**Files:**
- Modify: `src/lib/notifications/templates/types.ts:69-71`
- Modify: `supabase/functions/_shared/templates/types.ts:69-71`

- [ ] **Step 1: Update the Node payload type**

In `src/lib/notifications/templates/types.ts`, replace lines 69-71:

```ts
  | { type: 'ncn_raised'; booking_id: string; ncn_id: string }
  | { type: 'np_raised'; booking_id: string; np_id: string }
  | { type: 'completion_survey'; booking_id: string; survey_token: string }
```

with:

```ts
  | { type: 'ncn_raised'; booking_id: string; ncn_id: string; reason: string; notes?: string; photos?: string[]; contractor_fault?: boolean }
  | { type: 'np_raised'; booking_id: string; np_id: string; notes?: string; photos?: string[]; contractor_fault?: boolean }
  | { type: 'completion_survey'; booking_id: string; survey_token: string }
```

(Note: `completion_survey` is unchanged — just `survey_token`.)

- [ ] **Step 2: Mirror to Deno**

Make the identical change in `supabase/functions/_shared/templates/types.ts`.

- [ ] **Step 3: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/notifications/templates/types.ts supabase/functions/_shared/templates/types.ts
git commit -m "feat(notifications): expand ncn_raised/np_raised payload types with field metadata"
```

---

### Task 2: NCN raised template (TDD)

**Files:**
- Create: `src/__tests__/notifications/templates/ncn-raised.test.ts`
- Create: `src/lib/notifications/templates/ncn-raised.ts`
- Create: `supabase/functions/_shared/templates/ncn-raised.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/notifications/templates/ncn-raised.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderNcnRaised } from '@/lib/notifications/templates/ncn-raised'
import { makeMockBooking } from '../fixtures'

const APP_URL = 'https://verco.test'

describe('renderNcnRaised', () => {
  it('returns a subject containing the booking reference', () => {
    const booking = makeMockBooking({ ref: 'VV-NCN001' })
    const { subject } = renderNcnRaised(booking, APP_URL, { reason: 'Building Waste' })
    expect(subject).toBe('Non-conformance notice — VV-NCN001')
  })

  it('renders standard copy when contractor_fault is false or absent', () => {
    const booking = makeMockBooking()
    const { html } = renderNcnRaised(booking, APP_URL, { reason: 'Building Waste' })
    expect(html).toContain('non-conformance notice has been issued')
    expect(html).not.toContain('unable to complete')
  })

  it('renders softer copy when contractor_fault is true', () => {
    const booking = makeMockBooking()
    const { html } = renderNcnRaised(booking, APP_URL, {
      reason: 'Building Waste',
      contractor_fault: true,
    })
    expect(html).toContain('unable to complete your collection')
    expect(html).not.toContain('non-conformance notice has been issued')
  })

  it('renders the reason block with HTML escaping', () => {
    const booking = makeMockBooking()
    const { html } = renderNcnRaised(booking, APP_URL, {
      reason: '<script>alert(1)</script>',
    })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('renders notes when present, omits when absent', () => {
    const booking = makeMockBooking()
    const withNotes = renderNcnRaised(booking, APP_URL, {
      reason: 'Building Waste',
      notes: 'Items behind fence',
    })
    expect(withNotes.html).toContain('Items behind fence')

    const withoutNotes = renderNcnRaised(booking, APP_URL, {
      reason: 'Building Waste',
    })
    expect(withoutNotes.html).not.toContain('Notes')
  })

  it('renders photo thumbnails when present (max 4), omits when empty', () => {
    const booking = makeMockBooking()
    const photos = [
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.jpg',
      'https://cdn.example.com/3.jpg',
      'https://cdn.example.com/4.jpg',
      'https://cdn.example.com/5.jpg',
    ]
    const { html } = renderNcnRaised(booking, APP_URL, {
      reason: 'Building Waste',
      photos,
    })
    expect(html).toContain('cdn.example.com/1.jpg')
    expect(html).toContain('cdn.example.com/4.jpg')
    expect(html).not.toContain('cdn.example.com/5.jpg')

    const noPhotos = renderNcnRaised(booking, APP_URL, { reason: 'Building Waste' })
    expect(noPhotos.html).not.toContain('<img')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/templates/ncn-raised.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the template**

Create `src/lib/notifications/templates/ncn-raised.ts`:

```ts
import type { BookingForDispatch } from './types'
import { renderEmailLayout } from './_layout'
import type { RenderedEmail } from './booking-created'

export interface RenderNcnRaisedOptions {
  reason: string
  notes?: string | undefined
  photos?: string[] | undefined
  contractor_fault?: boolean | undefined
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

export function renderNcnRaised(
  booking: BookingForDispatch,
  appUrl: string,
  options: RenderNcnRaisedOptions
): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  const introCopy = options.contractor_fault
    ? 'We were unable to complete your collection as planned. A non-conformance notice has been issued.'
    : 'A non-conformance notice has been issued for your verge collection booking.'

  const reasonBlock = `<p style="margin:0 0 16px 0;padding:12px 16px;background:#F8F9FA;border-left:3px solid #8FA5B8;color:#293F52;font-size:14px"><strong>Reason:</strong> ${escapeHtml(options.reason)}</p>`

  const notesBlock = options.notes
    ? `<p style="margin:0 0 16px 0;color:#293F52;font-size:14px"><strong>Notes:</strong> ${escapeHtml(options.notes)}</p>`
    : ''

  const visiblePhotos = (options.photos ?? []).slice(0, 4)
  const photosBlock =
    visiblePhotos.length > 0
      ? `<div style="margin:0 0 16px 0">${visiblePhotos.map((url) => `<img src="${escapeHtml(url)}" alt="Photo" style="max-width:100%;height:auto;border-radius:4px;margin:0 0 8px 0;display:block" />`).join('')}</div>`
      : ''

  const bodyHtml = `
    <p style="margin:0 0 16px 0">${introCopy}</p>
    ${reasonBlock}
    ${notesBlock}
    ${photosBlock}
    <p style="margin:0 0 16px 0;color:#8FA5B8;font-size:13px">You have 14 days from the date of this notice to dispute it.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
    </table>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/booking/${encodeURIComponent(ref)}`

  return {
    subject: `Non-conformance notice — ${ref}`,
    html: renderEmailLayout({
      client: booking.client,
      preheader: `A non-conformance notice has been issued for booking ${ref}`,
      heading: 'Non-conformance notice',
      bodyHtml,
      ctaText: 'View booking',
      ctaUrl,
    }),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/templates/ncn-raised.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Mirror to Deno**

Copy `src/lib/notifications/templates/ncn-raised.ts` to `supabase/functions/_shared/templates/ncn-raised.ts`. Update imports to use `.ts` extensions:

```ts
import type { BookingForDispatch } from './types.ts'
import { renderEmailLayout } from './_layout.ts'
import type { RenderedEmail } from './booking-created.ts'
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/templates/ncn-raised.ts src/__tests__/notifications/templates/ncn-raised.test.ts supabase/functions/_shared/templates/ncn-raised.ts
git commit -m "feat(notifications): ncn-raised email template with TDD"
```

---

### Task 3: Nothing Presented template (TDD)

**Files:**
- Create: `src/__tests__/notifications/templates/np-raised.test.ts`
- Create: `src/lib/notifications/templates/np-raised.ts`
- Create: `supabase/functions/_shared/templates/np-raised.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/notifications/templates/np-raised.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderNpRaised } from '@/lib/notifications/templates/np-raised'
import { makeMockBooking } from '../fixtures'

const APP_URL = 'https://verco.test'

describe('renderNpRaised', () => {
  it('returns a subject containing the booking reference', () => {
    const booking = makeMockBooking({ ref: 'VV-NP001' })
    const { subject } = renderNpRaised(booking, APP_URL, {})
    expect(subject).toBe('Nothing presented — VV-NP001')
  })

  it('renders standard copy when contractor_fault is false or absent', () => {
    const booking = makeMockBooking()
    const { html } = renderNpRaised(booking, APP_URL, {})
    expect(html).toContain('no items were found on the verge')
    expect(html).not.toContain('unable to attend')
  })

  it('renders softer copy when contractor_fault is true', () => {
    const booking = makeMockBooking()
    const { html } = renderNpRaised(booking, APP_URL, { contractor_fault: true })
    expect(html).toContain('unable to attend your address')
    expect(html).not.toContain('no items were found')
  })

  it('renders notes when present, omits when absent', () => {
    const booking = makeMockBooking()
    const withNotes = renderNpRaised(booking, APP_URL, { notes: 'No waste visible' })
    expect(withNotes.html).toContain('No waste visible')

    const withoutNotes = renderNpRaised(booking, APP_URL, {})
    expect(withoutNotes.html).not.toContain('Notes')
  })

  it('includes the dispute window copy', () => {
    const booking = makeMockBooking()
    const { html } = renderNpRaised(booking, APP_URL, {})
    expect(html).toContain('14 days')
    expect(html).toContain('dispute')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/templates/np-raised.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the template**

Create `src/lib/notifications/templates/np-raised.ts`:

```ts
import type { BookingForDispatch } from './types'
import { renderEmailLayout } from './_layout'
import type { RenderedEmail } from './booking-created'

export interface RenderNpRaisedOptions {
  notes?: string | undefined
  photos?: string[] | undefined
  contractor_fault?: boolean | undefined
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

export function renderNpRaised(
  booking: BookingForDispatch,
  appUrl: string,
  options: RenderNpRaisedOptions
): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  const introCopy = options.contractor_fault
    ? 'We were unable to attend your address as planned.'
    : 'Our crew attended your address but no items were found on the verge.'

  const notesBlock = options.notes
    ? `<p style="margin:0 0 16px 0;color:#293F52;font-size:14px"><strong>Notes:</strong> ${escapeHtml(options.notes)}</p>`
    : ''

  const visiblePhotos = (options.photos ?? []).slice(0, 4)
  const photosBlock =
    visiblePhotos.length > 0
      ? `<div style="margin:0 0 16px 0">${visiblePhotos.map((url) => `<img src="${escapeHtml(url)}" alt="Photo" style="max-width:100%;height:auto;border-radius:4px;margin:0 0 8px 0;display:block" />`).join('')}</div>`
      : ''

  const bodyHtml = `
    <p style="margin:0 0 16px 0">${introCopy}</p>
    ${notesBlock}
    ${photosBlock}
    <p style="margin:0 0 16px 0;color:#8FA5B8;font-size:13px">You have 14 days from the date of this notice to dispute it.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
    </table>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/booking/${encodeURIComponent(ref)}`

  return {
    subject: `Nothing presented — ${ref}`,
    html: renderEmailLayout({
      client: booking.client,
      preheader: `Nothing was presented for collection at your address for booking ${ref}`,
      heading: 'Nothing presented',
      bodyHtml,
      ctaText: 'View booking',
      ctaUrl,
    }),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/templates/np-raised.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Mirror to Deno**

Copy to `supabase/functions/_shared/templates/np-raised.ts`. Update imports to `.ts` extensions:

```ts
import type { BookingForDispatch } from './types.ts'
import { renderEmailLayout } from './_layout.ts'
import type { RenderedEmail } from './booking-created.ts'
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/templates/np-raised.ts src/__tests__/notifications/templates/np-raised.test.ts supabase/functions/_shared/templates/np-raised.ts
git commit -m "feat(notifications): np-raised email template with TDD"
```

---

### Task 4: Completion survey template (TDD)

**Files:**
- Create: `src/__tests__/notifications/templates/completion-survey.test.ts`
- Create: `src/lib/notifications/templates/completion-survey.ts`
- Create: `supabase/functions/_shared/templates/completion-survey.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/notifications/templates/completion-survey.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderCompletionSurvey } from '@/lib/notifications/templates/completion-survey'
import { makeMockBooking } from '../fixtures'

const APP_URL = 'https://verco.test'

describe('renderCompletionSurvey', () => {
  it('returns a subject containing the booking reference', () => {
    const booking = makeMockBooking({ ref: 'VV-DONE01' })
    const { subject } = renderCompletionSurvey(booking, APP_URL, 'tok-abc-123')
    expect(subject).toBe('How was your collection? — VV-DONE01')
  })

  it('renders completion confirmation and feedback ask', () => {
    const booking = makeMockBooking()
    const { html } = renderCompletionSurvey(booking, APP_URL, 'tok-abc-123')
    expect(html).toContain('collection is complete')
    expect(html).toContain('feedback')
  })

  it('CTA links to the survey URL with the token', () => {
    const booking = makeMockBooking()
    booking.client.slug = 'kwn'
    const { html } = renderCompletionSurvey(booking, APP_URL, 'my-survey-token')
    expect(html).toContain('https://verco.test/kwn/survey/my-survey-token')
    expect(html).toContain('Complete survey')
  })

  it('does not contain dispute, reason, or photo blocks', () => {
    const booking = makeMockBooking()
    const { html } = renderCompletionSurvey(booking, APP_URL, 'tok-abc-123')
    expect(html).not.toContain('dispute')
    expect(html).not.toContain('Reason')
    expect(html).not.toContain('<img')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/templates/completion-survey.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the template**

Create `src/lib/notifications/templates/completion-survey.ts`:

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

export function renderCompletionSurvey(
  booking: BookingForDispatch,
  appUrl: string,
  surveyToken: string
): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  const bodyHtml = `
    <p style="margin:0 0 16px 0">Your verge collection is complete. We'd love to hear how it went.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
    </table>
    <p style="margin:0 0 16px 0">Your feedback helps us improve the service for everyone.</p>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/survey/${surveyToken}`

  return {
    subject: `How was your collection? — ${ref}`,
    html: renderEmailLayout({
      client: booking.client,
      preheader: `Your verge collection is complete — we'd love your feedback`,
      heading: 'Collection complete',
      bodyHtml,
      ctaText: 'Complete survey',
      ctaUrl,
    }),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/templates/completion-survey.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Mirror to Deno**

Copy to `supabase/functions/_shared/templates/completion-survey.ts`. Update imports to `.ts` extensions:

```ts
import type { BookingForDispatch } from './types.ts'
import { renderEmailLayout } from './_layout.ts'
import type { RenderedEmail } from './booking-created.ts'
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/templates/completion-survey.ts src/__tests__/notifications/templates/completion-survey.test.ts supabase/functions/_shared/templates/completion-survey.ts
git commit -m "feat(notifications): completion-survey email template with TDD"
```

---

### Task 5: Wire dispatcher — 3 new render cases (TDD)

**Files:**
- Modify: `src/__tests__/notifications/dispatch.test.ts`
- Modify: `src/__tests__/notifications/fixtures.ts`
- Modify: `src/lib/notifications/dispatch.ts:1-15, 231-238`
- Modify: `supabase/functions/_shared/dispatch.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/notifications/dispatch.test.ts`, inside the existing `describe('dispatch', ...)` block:

```ts
  it('routes ncn_raised to the NCN template with payload fields', async () => {
    const booking = makeMockBooking({ id: 'b-ncn' })
    const deps = createMockDispatchDeps({ bookings: { 'b-ncn': booking } })

    const result = await dispatch(deps, {
      type: 'ncn_raised',
      booking_id: 'b-ncn',
      ncn_id: 'ncn-1',
      reason: 'Building Waste',
      notes: 'Behind the fence',
    })

    expect(result).toMatchObject({ ok: true, sent: true })
    const emailCall = deps.sendEmailMock.mock.calls[0]?.[0] as { subject: string; htmlBody: string } | undefined
    expect(emailCall?.subject).toContain('Non-conformance notice')
    expect(emailCall?.htmlBody).toContain('Building Waste')
    expect(emailCall?.htmlBody).toContain('Behind the fence')
  })

  it('routes np_raised to the NP template with payload fields', async () => {
    const booking = makeMockBooking({ id: 'b-np' })
    const deps = createMockDispatchDeps({ bookings: { 'b-np': booking } })

    const result = await dispatch(deps, {
      type: 'np_raised',
      booking_id: 'b-np',
      np_id: 'np-1',
      contractor_fault: true,
    })

    expect(result).toMatchObject({ ok: true, sent: true })
    const emailCall = deps.sendEmailMock.mock.calls[0]?.[0] as { subject: string; htmlBody: string } | undefined
    expect(emailCall?.subject).toContain('Nothing presented')
    expect(emailCall?.htmlBody).toContain('unable to attend')
  })

  it('routes completion_survey to the survey template with token in CTA', async () => {
    const booking = makeMockBooking({ id: 'b-survey' })
    const deps = createMockDispatchDeps({ bookings: { 'b-survey': booking } })

    const result = await dispatch(deps, {
      type: 'completion_survey',
      booking_id: 'b-survey',
      survey_token: 'tok-xyz',
    })

    expect(result).toMatchObject({ ok: true, sent: true })
    const emailCall = deps.sendEmailMock.mock.calls[0]?.[0] as { subject: string; htmlBody: string } | undefined
    expect(emailCall?.subject).toContain('How was your collection')
    expect(emailCall?.htmlBody).toContain('tok-xyz')
    expect(emailCall?.htmlBody).toContain('Complete survey')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: 3 new tests FAIL — "Template not yet implemented for type" error

- [ ] **Step 3: Update the dispatcher imports and render cases**

In `src/lib/notifications/dispatch.ts`, add imports after line 15:

```ts
import {
  renderNcnRaised,
  type RenderNcnRaisedOptions,
} from './templates/ncn-raised'
import {
  renderNpRaised,
  type RenderNpRaisedOptions,
} from './templates/np-raised'
import { renderCompletionSurvey } from './templates/completion-survey'
```

Then replace lines 231-238 (the `payment_reminder` through `completion_survey` cases):

```ts
    case 'payment_reminder':
    case 'payment_expired':
      throw new Error(
        `Template not yet implemented for type: ${payload.type} (lands in later phase)`
      )
    case 'ncn_raised': {
      const opts: RenderNcnRaisedOptions = {
        reason: payload.reason,
        notes: payload.notes,
        photos: payload.photos,
        contractor_fault: payload.contractor_fault,
      }
      return renderNcnRaised(booking, appUrl, opts)
    }
    case 'np_raised': {
      const opts: RenderNpRaisedOptions = {
        notes: payload.notes,
        photos: payload.photos,
        contractor_fault: payload.contractor_fault,
      }
      return renderNpRaised(booking, appUrl, opts)
    }
    case 'completion_survey':
      return renderCompletionSurvey(booking, appUrl, payload.survey_token)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/notifications/dispatch.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Mirror to Deno**

Make the identical changes in `supabase/functions/_shared/dispatch.ts`:
- Add imports (with `.ts` extensions) for `renderNcnRaised`, `RenderNcnRaisedOptions`, `renderNpRaised`, `RenderNpRaisedOptions`, `renderCompletionSurvey`
- Replace the same switch cases

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/dispatch.ts src/__tests__/notifications/dispatch.test.ts supabase/functions/_shared/dispatch.ts
git commit -m "feat(notifications): wire ncn_raised, np_raised, completion_survey in dispatcher"
```

---

### Task 6: PII leak tests for new templates

**Files:**
- Modify: `src/__tests__/notifications/pii-leak.test.ts`

- [ ] **Step 1: Add PII leak tests for 3 new types**

Add to the existing `describe('PII leak regression', ...)` block in `src/__tests__/notifications/pii-leak.test.ts`:

```ts
  it('ncn_raised template does not contain contact full_name, email, or mobile', async () => {
    const booking = makePiiLoadedBooking()
    const deps = createMockDispatchDeps({ bookings: { [booking.id]: booking } })

    await dispatch(deps, {
      type: 'ncn_raised',
      booking_id: booking.id,
      ncn_id: 'ncn-pii-test',
      reason: 'Building Waste',
      notes: 'Test notes',
    })

    expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
    const call = deps.sendEmailMock.mock.calls[0]![0]
    const html: string = call.htmlBody

    expect(html).not.toContain(PII_STRINGS.full_name)
    expect(html).not.toContain(PII_STRINGS.email)
    expect(html).not.toContain(PII_STRINGS.mobile_e164)
  })

  it('np_raised template does not contain contact full_name, email, or mobile', async () => {
    const booking = makePiiLoadedBooking()
    const deps = createMockDispatchDeps({ bookings: { [booking.id]: booking } })

    await dispatch(deps, {
      type: 'np_raised',
      booking_id: booking.id,
      np_id: 'np-pii-test',
    })

    expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
    const call = deps.sendEmailMock.mock.calls[0]![0]
    const html: string = call.htmlBody

    expect(html).not.toContain(PII_STRINGS.full_name)
    expect(html).not.toContain(PII_STRINGS.email)
    expect(html).not.toContain(PII_STRINGS.mobile_e164)
  })

  it('completion_survey template does not contain contact full_name, email, or mobile', async () => {
    const booking = makePiiLoadedBooking()
    const deps = createMockDispatchDeps({ bookings: { [booking.id]: booking } })

    await dispatch(deps, {
      type: 'completion_survey',
      booking_id: booking.id,
      survey_token: 'tok-pii-test',
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
Expected: All 5 tests PASS (2 existing + 3 new)

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/notifications/pii-leak.test.ts
git commit -m "test(notifications): PII leak regression for ncn_raised, np_raised, completion_survey"
```

---

### Task 7: Wire field actions — raiseNcn, raiseNothingPresented, completeBooking

**Files:**
- Modify: `src/app/(field)/field/booking/[ref]/actions.ts:53-80, 111-138, 174-195`

- [ ] **Step 1: Add the `invokeSendNotification` helper at the bottom of the file**

Add after the `saveMudActualServices` function (after line 254):

```ts
/**
 * Fire-and-forget POST to the send-notification Edge Function.
 *
 * Uses the user's session access token (not service role — CLAUDE.md §20).
 * The EF accepts field/ranger JWTs and validates the role before dispatching.
 * Field callers never touch PII — the EF uses service role internally to
 * resolve the contact.
 */
async function invokeSendNotification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: {
    type: 'ncn_raised' | 'np_raised' | 'completion_survey'
    booking_id: string
    [key: string]: unknown
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

- [ ] **Step 2: Wire `raiseNcn` — capture ncn_id + fire notification**

In `src/app/(field)/field/booking/[ref]/actions.ts`, update the NCN insert (lines 116-128) to capture the ID. Replace:

```ts
  const { error: ncnError } = await supabase
    .from('non_conformance_notice')
    .insert({
      booking_id: bookingId,
      client_id: clientId,
      reason,
      notes: notes || null,
      photos: photoUrls,
      reported_by: user?.id ?? null,
      reported_at: new Date().toISOString(),
      status: 'Issued',
    })

  if (ncnError) return { ok: false, error: ncnError.message }
```

with:

```ts
  const { data: ncnRow, error: ncnError } = await supabase
    .from('non_conformance_notice')
    .insert({
      booking_id: bookingId,
      client_id: clientId,
      reason,
      notes: notes || null,
      photos: photoUrls,
      reported_by: user?.id ?? null,
      reported_at: new Date().toISOString(),
      status: 'Issued',
    })
    .select('id')
    .single()

  if (ncnError) return { ok: false, error: ncnError.message }
```

Then after the booking status update (after line 137 — `if (updateError) return ...`), add before the final return:

```ts
  // Fire NCN notification — fire-and-forget
  await invokeSendNotification(supabase, {
    type: 'ncn_raised',
    booking_id: bookingId,
    ncn_id: ncnRow?.id ?? '',
    reason,
    notes: notes || undefined,
    photos: photoUrls.length > 0 ? photoUrls : undefined,
  })

  return { ok: true, data: undefined }
```

Remove the existing `return { ok: true, data: undefined }` on line 138 (replaced above).

- [ ] **Step 3: Wire `raiseNothingPresented` — capture np_id + fire notification**

Update the NP insert (lines 174-186) to capture the ID. Replace:

```ts
  const { error: npError } = await supabase
    .from('nothing_presented')
    .insert({
      booking_id: bookingId,
      client_id: clientId,
      notes: notes || null,
      photos: photoUrls,
      contractor_fault: dmFault,
      reported_by: user?.id ?? null,
      reported_at: new Date().toISOString(),
      status: 'Issued',
    })

  if (npError) return { ok: false, error: npError.message }
```

with:

```ts
  const { data: npRow, error: npError } = await supabase
    .from('nothing_presented')
    .insert({
      booking_id: bookingId,
      client_id: clientId,
      notes: notes || null,
      photos: photoUrls,
      contractor_fault: dmFault,
      reported_by: user?.id ?? null,
      reported_at: new Date().toISOString(),
      status: 'Issued',
    })
    .select('id')
    .single()

  if (npError) return { ok: false, error: npError.message }
```

Then after the booking status update (after line 194), add before the final return:

```ts
  // Fire NP notification — fire-and-forget
  await invokeSendNotification(supabase, {
    type: 'np_raised',
    booking_id: bookingId,
    np_id: npRow?.id ?? '',
    notes: notes || undefined,
    photos: photoUrls.length > 0 ? photoUrls : undefined,
    contractor_fault: dmFault,
  })

  return { ok: true, data: undefined }
```

Remove the existing `return { ok: true, data: undefined }` on line 195.

- [ ] **Step 4: Wire `completeBooking` — create survey + fire notification**

In `completeBooking` (lines 53-80), add `import { headers } from 'next/headers'` if not already at the top (it IS already imported on line 3 — so no action needed).

After the booking status update (after line 78 — `if (error) return ...`), replace the final return with:

```ts
  // Create survey + fire completion notification
  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')

  if (clientId) {
    const surveyToken = crypto.randomUUID()
    const { error: surveyError } = await supabase
      .from('booking_survey')
      .insert({
        booking_id: bookingId,
        client_id: clientId,
        token: surveyToken,
      })

    if (surveyError) {
      console.error('Failed to create booking_survey:', surveyError.message)
    } else {
      await invokeSendNotification(supabase, {
        type: 'completion_survey',
        booking_id: bookingId,
        survey_token: surveyToken,
      })
    }
  }

  return { ok: true, data: undefined }
```

Remove the existing `return { ok: true, data: undefined }` on line 79.

- [ ] **Step 5: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 6: PII sanity grep**

Run: `grep -n 'contacts\.full_name\|contacts\.email\|contacts\.mobile_e164' src/app/\(field\)/field/booking/\[ref\]/actions.ts`
Expected: No matches (field code never touches contacts)

- [ ] **Step 7: Commit**

```bash
git add src/app/(field)/field/booking/[ref]/actions.ts
git commit -m "feat(notifications): wire NCN, NP, and completion survey notifications in field actions"
```

---

### Task 8: Full test suite + CI sync verification

**Files:**
- All test files from prior tasks

- [ ] **Step 1: Run the full notification test suite**

Run: `pnpm vitest run src/__tests__/notifications/`
Expected: All tests PASS

- [ ] **Step 2: Run the CI template-sync check**

Run: `diff <(cat src/lib/notifications/templates/types.ts) <(cat supabase/functions/_shared/templates/types.ts)`
Expected: No diff

Run: `diff <(cat src/lib/notifications/templates/ncn-raised.ts) <(cat supabase/functions/_shared/templates/ncn-raised.ts)`
Expected: Import extension diffs only

Run: `diff <(cat src/lib/notifications/templates/np-raised.ts) <(cat supabase/functions/_shared/templates/np-raised.ts)`
Expected: Import extension diffs only

Run: `diff <(cat src/lib/notifications/templates/completion-survey.ts) <(cat supabase/functions/_shared/templates/completion-survey.ts)`
Expected: Import extension diffs only

Run: `diff <(cat src/lib/notifications/dispatch.ts) <(cat supabase/functions/_shared/dispatch.ts)`
Expected: Import extension diffs only

- [ ] **Step 3: Run the full project type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit (if any fixups were needed)**

Only if prior steps required corrections.

```bash
git commit -m "fix(notifications): fixups from full Phase 3 test run"
```
