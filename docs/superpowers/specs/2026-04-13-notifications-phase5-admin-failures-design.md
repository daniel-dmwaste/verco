# Phase 5 — Admin Failures Page + Manual Retry

**Linear:** VER-123
**Branch:** `feature/notifications`
**Date:** 2026-04-13

## Summary

Admin page showing failed notification_log rows from the past 7 days with a click-to-retry button. The retry action uses a row-locked RPC to prevent concurrent double-sends, then dispatches via the Phase 4 resume-by-log-id path.

## Decision Record

- **Click-to-retry without confirmation dialog.** Retry is non-destructive (worst case = double email). Simple inline button with optimistic disable + spinner.
- **Row-level locking via Postgres RPC.** `SELECT FOR UPDATE` isn't available via the Supabase JS client, so the lock-then-update is a `SECURITY DEFINER` RPC.
- **No badge count in sidebar.** The page itself shows the count. Adding a badge would require a count query on every admin page load — not worth it for an ops tool.

## Changes

### 1. RPC migration — `retry_notification_log`

**File:** `supabase/migrations/<timestamp>_retry_notification_log_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION retry_notification_log(log_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM notification_log
  WHERE id = log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification log row not found: %', log_id;
  END IF;

  IF v_status <> 'failed' THEN
    RAISE EXCEPTION 'Row is not in failed status (current: %)', v_status;
  END IF;

  UPDATE notification_log
  SET status = 'queued', error_message = NULL
  WHERE id = log_id;

  RETURN log_id;
END;
$$;
```

The `FOR UPDATE` lock blocks concurrent callers on the same row. If two admins click retry simultaneously, one succeeds and the other gets "Row is not in failed status (current: queued)".

### 2. Server page

**File:** `src/app/(admin)/admin/notifications/page.tsx`

Standard Suspense wrapper:

```tsx
import { Suspense } from 'react'
import { NotificationsClient } from './notifications-client'

export default function NotificationsPage() {
  return (
    <Suspense>
      <NotificationsClient />
    </Suspense>
  )
}
```

### 3. Client component

**File:** `src/app/(admin)/admin/notifications/notifications-client.tsx`

- `'use client'` directive
- `useQuery` fetching `notification_log` with:
  - `status = 'failed'`
  - `created_at > NOW() - 7 days`
  - Joined: `booking:booking_id(ref)`, `contacts:contact_id(email)`
  - Order: `created_at desc`
- Table columns: Booking Ref (link to `/admin/bookings/{booking_id}`), Type (human-readable label), Recipient (email), Error, Time (relative), Retry
- Client-side filter dropdown: All types / booking_created / booking_cancelled / ncn_raised / np_raised / completion_survey / payment_reminder / payment_expired
- Empty state: "No failed notifications in the past 7 days"
- Loading: 5x `SkeletonRow` with column count matching
- Header: `border-b border-gray-100 bg-white px-7 pb-5 pt-6` with "Notifications" title + "{n} failed" subtitle

**Retry button per row:**
- Default: "Retry" text button
- On click: calls `retryNotification(log_id)`, optimistically disables + shows spinner
- On success: refetch query (row disappears or shows new status)
- On "already in flight" error: show inline error text "Already retried"
- On other error: show inline error text with message

### 4. Retry server action

**File:** `src/app/(admin)/admin/notifications/actions.ts`

```ts
'use server'

export async function retryNotification(logId: string): Promise<Result<void>>
```

1. Role check — admin roles only (`client-admin`, `client-staff`, `contractor-admin`, `contractor-staff`)
2. Call `supabase.rpc('retry_notification_log', { log_id: logId })` — this locks the row, validates `failed` status, and sets to `queued`
3. If RPC fails, return error (includes "not in failed status" for concurrent retries)
4. Fire `send-notification` with `{ notification_log_id: logId }` via `invokeSendNotification` helper (same pattern as other admin actions)
5. Return success

### 5. Sidebar nav — add Notifications

**File:** `src/components/admin/admin-sidebar.tsx`

Add to the "Admin" section (after "Bug Reports"):

```ts
{ label: 'Notifications', href: '/admin/notifications', icon: ICON.notifications },
```

Add a bell icon to the `ICON` const:

```tsx
notifications: (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
),
```

### 6. Notification type labels

Map from DB enum values to human-readable display labels used in the table and filter:

| DB value | Display label |
|---|---|
| `booking_created` | Booking Created |
| `booking_cancelled` | Booking Cancelled |
| `ncn_raised` | NCN Raised |
| `np_raised` | Nothing Presented |
| `completion_survey` | Survey |
| `payment_reminder` | Payment Reminder |
| `payment_expired` | Payment Expired |

## Files touched

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_retry_notification_log_rpc.sql` | Create | Row-locked retry RPC |
| `src/app/(admin)/admin/notifications/page.tsx` | Create | Suspense wrapper |
| `src/app/(admin)/admin/notifications/notifications-client.tsx` | Create | Client component |
| `src/app/(admin)/admin/notifications/actions.ts` | Create | Retry server action |
| `src/components/admin/admin-sidebar.tsx` | Modify:56, 134-139 | Add nav item + icon |

## Out of scope

- Automatic retry cron
- Retry count column
- Badge count in sidebar
- Date range filter beyond 7-day window
- Confirmation dialog before retry
