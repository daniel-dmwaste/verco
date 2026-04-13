# Phase 3 — Field-Triggered Notifications (NCN, NP, Completion Survey)

**Linear:** VER-121
**Branch:** `feature/notifications`
**Date:** 2026-04-13

## Summary

Wire three notification types triggered by field-role server actions: NCN raised, Nothing Presented raised, and booking completion with survey link. This phase activates the existing survey frontend (`/survey/[token]`) with real traffic.

## Decision Record

- **NCN/NP data on payload, not loaded from DB.** The field action already has reason, notes, photos, contractor_fault in scope. Passing them on the payload avoids coupling the dispatcher to the NCN/NP schema and adding a new DB query path.
- **`ncn_id` / `np_id` kept on payload** for notification_log correlation — not used by the template.
- **Survey token generated in server action** using `crypto.randomUUID()`. The `booking_survey` row is created BEFORE the notification call (survey must exist before the email links to it).
- **PII model preserved.** Field actions pass `booking_id` + metadata only. The EF uses service role internally to resolve the contact. Field code never touches `contacts` table.

## Changes

### 1. Payload type — expand NCN/NP/survey variants

**Files:** `src/lib/notifications/templates/types.ts`, `supabase/functions/_shared/templates/types.ts`

Replace the three stub variants:

```ts
| { type: 'ncn_raised'; booking_id: string; ncn_id: string; reason: string; notes?: string; photos?: string[]; contractor_fault?: boolean }
| { type: 'np_raised'; booking_id: string; np_id: string; notes?: string; photos?: string[]; contractor_fault?: boolean }
| { type: 'completion_survey'; booking_id: string; survey_token: string }
```

### 2. NCN raised template

**Files:** `src/lib/notifications/templates/ncn-raised.ts`, `supabase/functions/_shared/templates/ncn-raised.ts`

Options interface:

```ts
export interface RenderNcnRaisedOptions {
  reason: string
  notes?: string | undefined
  photos?: string[] | undefined
  contractor_fault?: boolean | undefined
}
```

Content:
- Subject: `Non-conformance notice — {ref}`
- Preheader: `A non-conformance notice has been issued for booking {ref}`
- Heading: `Non-conformance notice`
- Body:
  - If `contractor_fault`: "We were unable to complete your collection as planned. A non-conformance notice has been issued."
  - Else: "A non-conformance notice has been issued for your verge collection booking."
  - Reason block (styled callout, same as cancel reason block — `escapeHtml` the reason)
  - Notes block (if present, plain paragraph — `escapeHtml`)
  - Photo thumbnails (if present, `<img>` tags with `max-width:100%;height:auto`, max 4 photos)
  - Dispute copy: "You have 14 days from the date of this notice to dispute it."
  - Details table: ref, collection date, address
- CTA: "View booking" → `{appUrl}/{client_slug}/booking/{ref}`

### 3. Nothing Presented template

**Files:** `src/lib/notifications/templates/np-raised.ts`, `supabase/functions/_shared/templates/np-raised.ts`

Options interface:

```ts
export interface RenderNpRaisedOptions {
  notes?: string | undefined
  photos?: string[] | undefined
  contractor_fault?: boolean | undefined
}
```

Content:
- Subject: `Nothing presented — {ref}`
- Preheader: `Nothing was presented for collection at your address for booking {ref}`
- Heading: `Nothing presented`
- Body:
  - If `contractor_fault`: "We were unable to attend your address as planned."
  - Else: "Our crew attended your address but no items were found on the verge."
  - Notes block (if present)
  - Photo thumbnails (if present, same pattern as NCN)
  - Dispute copy: "You have 14 days from the date of this notice to dispute it."
  - Details table: ref, collection date, address
- CTA: "View booking" → `{appUrl}/{client_slug}/booking/{ref}`

### 4. Completion survey template

**Files:** `src/lib/notifications/templates/completion-survey.ts`, `supabase/functions/_shared/templates/completion-survey.ts`

No options interface needed — survey_token comes via a separate parameter.

Content:
- Subject: `How was your collection? — {ref}`
- Preheader: `Your verge collection is complete — we'd love your feedback`
- Heading: `Collection complete`
- Body:
  - "Your verge collection is complete. We'd love to hear how it went."
  - Details table: ref, collection date, address
  - "Your feedback helps us improve the service for everyone."
- CTA: "Complete survey" → `{appUrl}/{client_slug}/survey/{survey_token}`

### 5. Dispatcher — add three cases to `renderTemplate`

**Files:** `src/lib/notifications/dispatch.ts`, `supabase/functions/_shared/dispatch.ts`

Replace the `throw new Error(...)` stubs for `ncn_raised`, `np_raised`, `completion_survey` with real render calls, forwarding payload fields into each template's options.

### 6. Field actions — wire notifications

**File:** `src/app/(field)/field/booking/[ref]/actions.ts`

**`raiseNcn` (line 116-138):**
- Change NCN insert to `.select('id').single()` to capture the `ncn_id`
- After the booking status update, fire `send-notification` with:
  ```ts
  { type: 'ncn_raised', booking_id: bookingId, ncn_id, reason, notes, photos: photoUrls, contractor_fault: false }
  ```
  Note: `contractor_fault` defaults to `false` for field-raised NCNs (the field UI doesn't expose this flag — it's set by admin during review).

**`raiseNothingPresented` (line 141-196):**
- Change NP insert to `.select('id').single()` to capture the `np_id`
- After the booking status update, fire `send-notification` with:
  ```ts
  { type: 'np_raised', booking_id: bookingId, np_id, notes, photos: photoUrls, contractor_fault: dmFault }
  ```
  Note: `dmFault` (the `contractor_fault` param) IS exposed in the NP form — the crew marks whether they're at fault.

**`completeBooking` (line 53-80):**
- After the booking status update, read `x-client-id` from headers
- Insert `booking_survey` row with `booking_id`, `client_id`, `token: crypto.randomUUID()`
- Fire `send-notification` with:
  ```ts
  { type: 'completion_survey', booking_id: bookingId, survey_token: token }
  ```

**All three actions** get the same `invokeSendNotification` helper pattern (fire-and-forget, user JWT auth).

### 7. Tests

**New template tests:**
- `src/__tests__/notifications/templates/ncn-raised.test.ts` (6 tests):
  - Subject contains ref
  - Default copy (non-contractor-fault)
  - Contractor fault — softer copy
  - Reason block rendered + escaped
  - Notes block rendered when present, omitted when absent
  - Photo thumbnails rendered (max 4), omitted when empty
- `src/__tests__/notifications/templates/np-raised.test.ts` (5 tests):
  - Subject contains ref
  - Default copy
  - Contractor fault — softer copy
  - Notes + photos rendered/omitted
  - Dispute window copy present
- `src/__tests__/notifications/templates/completion-survey.test.ts` (4 tests):
  - Subject contains ref
  - Body contains "complete" + feedback ask
  - CTA links to survey URL with token
  - No dispute/reason/photo blocks

**Dispatch tests:**
- 3 new tests: each type routes to the correct template and forwards payload fields

**PII leak test:**
- Extend existing `pii-leak.test.ts` to cover `ncn_raised`, `np_raised`, `completion_survey` — verify rendered HTML doesn't contain PII strings

### 8. Deno mirror sync

All new template files + type/dispatch changes mirrored. CI template-sync guard enforces.

## Files touched

| File | Action | Responsibility |
|---|---|---|
| `src/lib/notifications/templates/types.ts` | Modify | Expand payload variants |
| `src/lib/notifications/templates/ncn-raised.ts` | Create | NCN template |
| `src/lib/notifications/templates/np-raised.ts` | Create | NP template |
| `src/lib/notifications/templates/completion-survey.ts` | Create | Survey template |
| `src/lib/notifications/dispatch.ts` | Modify | Add 3 render cases |
| `src/app/(field)/field/booking/[ref]/actions.ts` | Modify | Wire notifications |
| `supabase/functions/_shared/templates/types.ts` | Modify | Mirror types |
| `supabase/functions/_shared/templates/ncn-raised.ts` | Create | Mirror NCN |
| `supabase/functions/_shared/templates/np-raised.ts` | Create | Mirror NP |
| `supabase/functions/_shared/templates/completion-survey.ts` | Create | Mirror survey |
| `supabase/functions/_shared/dispatch.ts` | Modify | Mirror dispatcher |
| `src/__tests__/notifications/templates/ncn-raised.test.ts` | Create | NCN tests |
| `src/__tests__/notifications/templates/np-raised.test.ts` | Create | NP tests |
| `src/__tests__/notifications/templates/completion-survey.test.ts` | Create | Survey tests |
| `src/__tests__/notifications/dispatch.test.ts` | Modify | 3 new routing tests |
| `src/__tests__/notifications/pii-leak.test.ts` | Modify | Cover 3 new types |

## Out of scope

- Survey frontend changes (already built)
- NCN/NP admin UI changes
- SMS channel
- Notification preferences / unsubscribe
- Abandoned cart (Phase 4)
