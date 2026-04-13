# Phase 5 — Admin Failures Page + Manual Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin page at `/admin/notifications` showing failed notification_log rows from the past 7 days with a click-to-retry button that uses a row-locked RPC to prevent concurrent double-sends.

**Architecture:** Standard admin page pattern (server Suspense wrapper + client component with TanStack Query). Retry action uses a `SECURITY DEFINER` Postgres RPC for row-level locking (`SELECT FOR UPDATE`), then dispatches via the Phase 4 resume-by-log-id path. Navigation gets a new "Notifications" entry in the Admin sidebar section.

**Tech Stack:** TypeScript, Next.js App Router, TanStack Query, Supabase RPC, Postgres `FOR UPDATE`

**Spec:** `docs/superpowers/specs/2026-04-13-notifications-phase5-admin-failures-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_retry_notification_log_rpc.sql` | Create | Row-locked retry RPC |
| `src/app/(admin)/admin/notifications/page.tsx` | Create | Suspense wrapper |
| `src/app/(admin)/admin/notifications/notifications-client.tsx` | Create | Client component — table, filters, retry |
| `src/app/(admin)/admin/notifications/actions.ts` | Create | Retry server action |
| `src/components/admin/admin-sidebar.tsx` | Modify:56, 134-139 | Add bell icon + nav item |

---

### Task 1: RPC migration — `retry_notification_log`

**Files:**
- Create: `supabase/migrations/<timestamp>_retry_notification_log_rpc.sql`

- [ ] **Step 1: Create the migration**

Run: `pnpm supabase migration new retry_notification_log_rpc`

- [ ] **Step 2: Write the migration**

Add to the created file:

```sql
-- =============================================================================
-- RPC: retry_notification_log
-- Row-locked retry guard for the admin notifications retry button.
-- Uses SELECT FOR UPDATE to prevent concurrent double-sends.
-- =============================================================================

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

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(notifications): retry_notification_log RPC with row-level locking"
```

---

### Task 2: Retry server action

**Files:**
- Create: `src/app/(admin)/admin/notifications/actions.ts`

- [ ] **Step 1: Create the server action**

Create `src/app/(admin)/admin/notifications/actions.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

export async function retryNotification(logId: string): Promise<Result<void>> {
  if (!logId) {
    return { ok: false, error: 'Log ID is required.' }
  }

  const supabase = await createClient()

  // Verify admin role
  const { data: role } = await supabase.rpc('current_user_role')
  const adminRoles = ['client-admin', 'client-staff', 'contractor-admin', 'contractor-staff']
  if (!role || !adminRoles.includes(role)) {
    return { ok: false, error: 'Insufficient permissions.' }
  }

  // Lock the row, validate failed status, set to queued
  const { error: rpcError } = await supabase.rpc('retry_notification_log', {
    log_id: logId,
  })

  if (rpcError) {
    // RPC raises exceptions for not-found and not-failed-status
    return { ok: false, error: rpcError.message }
  }

  // Dispatch via resume-by-log-id path (fire-and-forget)
  await invokeSendNotification(supabase, logId)

  return { ok: true, data: undefined }
}

/**
 * Fire-and-forget POST to the send-notification Edge Function.
 * Uses the resume-by-log-id input variant from Phase 4.
 */
async function invokeSendNotification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notificationLogId: string
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
      body: JSON.stringify({ notification_log_id: notificationLogId }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      console.error(
        `[notifications] send-notification returned ${res.status} for retry ${notificationLogId}: ${body}`
      )
    }
  } catch (err) {
    console.error(
      `[notifications] Failed to invoke send-notification for retry ${notificationLogId}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/(admin)/admin/notifications/actions.ts
git commit -m "feat(notifications): retryNotification server action with row-locked RPC"
```

---

### Task 3: Admin notifications page (server + client)

**Files:**
- Create: `src/app/(admin)/admin/notifications/page.tsx`
- Create: `src/app/(admin)/admin/notifications/notifications-client.tsx`

- [ ] **Step 1: Create the server page**

Create `src/app/(admin)/admin/notifications/page.tsx`:

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

- [ ] **Step 2: Create the client component**

Create `src/app/(admin)/admin/notifications/notifications-client.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SkeletonRow } from '@/components/ui/skeleton'
import { retryNotification } from './actions'

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  booking_created: 'Booking Created',
  booking_cancelled: 'Booking Cancelled',
  ncn_raised: 'NCN Raised',
  np_raised: 'Nothing Presented',
  completion_survey: 'Survey',
  payment_reminder: 'Payment Reminder',
  payment_expired: 'Payment Expired',
}

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'booking_created', label: 'Booking Created' },
  { value: 'booking_cancelled', label: 'Booking Cancelled' },
  { value: 'ncn_raised', label: 'NCN Raised' },
  { value: 'np_raised', label: 'Nothing Presented' },
  { value: 'completion_survey', label: 'Survey' },
  { value: 'payment_reminder', label: 'Payment Reminder' },
  { value: 'payment_expired', label: 'Payment Expired' },
]

export function NotificationsClient() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({})

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: logs, isLoading } = useQuery({
    queryKey: ['admin-notification-failures', typeFilter],
    queryFn: async () => {
      let query = supabase
        .from('notification_log')
        .select(
          `id, booking_id, notification_type, to_address, error_message, created_at, status,
           booking:booking_id(ref)`
        )
        .eq('status', 'failed')
        .gt('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })

      if (typeFilter) {
        query = query.eq('notification_type', typeFilter)
      }

      const { data, error } = await query
      if (error) {
        console.error('Failed to fetch notification failures:', error.message)
        return []
      }
      return data ?? []
    },
  })

  const handleRetry = async (logId: string) => {
    setRetryingIds((prev) => new Set(prev).add(logId))
    setRetryErrors((prev) => {
      const next = { ...prev }
      delete next[logId]
      return next
    })

    const result = await retryNotification(logId)

    setRetryingIds((prev) => {
      const next = new Set(prev)
      next.delete(logId)
      return next
    })

    if (!result.ok) {
      setRetryErrors((prev) => ({ ...prev, [logId]: result.error }))
    } else {
      // Refetch to remove the now-queued/sent row
      queryClient.invalidateQueries({ queryKey: ['admin-notification-failures'] })
    }
  }

  const failedCount = logs?.length ?? 0

  return (
    <div>
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-7 pb-5 pt-6">
        <h1 className="font-[family-name:var(--font-heading)] text-title font-semibold text-gray-900">
          Notifications
        </h1>
        <p className="mt-1 text-body-sm text-gray-500">
          {isLoading
            ? 'Loading...'
            : failedCount === 0
              ? 'No failed notifications in the past 7 days'
              : `${failedCount} failed in the past 7 days`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-7 py-4">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-body-sm text-gray-700"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="px-7">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-400">Booking</th>
              <th className="px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-400">Type</th>
              <th className="px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-400">Recipient</th>
              <th className="px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-400">Error</th>
              <th className="px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-400">Time</th>
              <th className="px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-400"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={i} columns={6} />
                ))}
              </>
            )}

            {!isLoading && failedCount === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-body-sm text-gray-400">
                  No failed notifications in the past 7 days
                </td>
              </tr>
            )}

            {!isLoading &&
              (logs ?? []).map((log) => {
                const bookingRef =
                  log.booking && typeof log.booking === 'object' && 'ref' in log.booking
                    ? (log.booking as { ref: string }).ref
                    : null
                const isRetrying = retryingIds.has(log.id)
                const retryError = retryErrors[log.id]

                return (
                  <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-body-sm">
                      {bookingRef && log.booking_id ? (
                        <Link
                          href={`/admin/bookings/${log.booking_id}`}
                          className="font-medium text-[#293F52] underline decoration-gray-300 underline-offset-2 hover:decoration-[#293F52]"
                        >
                          {bookingRef}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-gray-600">
                      {NOTIFICATION_TYPE_LABELS[log.notification_type] ?? log.notification_type}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-gray-600">
                      {log.to_address === 'pending' ? (
                        <span className="text-gray-400">pending</span>
                      ) : (
                        log.to_address
                      )}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-body-sm text-gray-500" title={log.error_message ?? ''}>
                      {log.error_message ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-body-sm text-gray-400">
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {retryError ? (
                        <span className="text-2xs text-red-500">{retryError.includes('not in failed') ? 'Already retried' : retryError}</span>
                      ) : (
                        <button
                          onClick={() => handleRetry(log.id)}
                          disabled={isRetrying}
                          className="rounded bg-[#293F52] px-3 py-1 text-2xs font-medium text-white transition-colors hover:bg-[#1e3040] disabled:opacity-50"
                        >
                          {isRetrying ? (
                            <span className="flex items-center gap-1.5">
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                              </svg>
                              Retrying
                            </span>
                          ) : (
                            'Retry'
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/(admin)/admin/notifications/page.tsx src/app/(admin)/admin/notifications/notifications-client.tsx
git commit -m "feat(notifications): admin notifications page — failed log table + retry"
```

---

### Task 4: Add Notifications to admin sidebar

**Files:**
- Modify: `src/components/admin/admin-sidebar.tsx:56, 134-139`

- [ ] **Step 1: Add the bell icon**

In `src/components/admin/admin-sidebar.tsx`, add to the `ICON` const (after the `allocations` entry around line 54, before the closing `}`):

```ts
  notifications: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
  ),
```

- [ ] **Step 2: Add the nav item**

In the `sections` array, find the "Admin" section (around line 134-139). Add the Notifications item after "Bug Reports":

Replace:

```ts
    {
      title: 'Admin',
      items: [
        { label: 'Users', href: '/admin/users', icon: ICON.users },
        { label: 'Bug Reports', href: '/admin/bug-reports', icon: ICON.bug },
      ],
    },
```

with:

```ts
    {
      title: 'Admin',
      items: [
        { label: 'Users', href: '/admin/users', icon: ICON.users },
        { label: 'Bug Reports', href: '/admin/bug-reports', icon: ICON.bug },
        { label: 'Notifications', href: '/admin/notifications', icon: ICON.notifications },
      ],
    },
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/admin-sidebar.tsx
git commit -m "feat(notifications): add Notifications to admin sidebar nav"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: All tests PASS (no test regressions from UI additions)

- [ ] **Step 3: Start dev server and verify the page**

Run: `pnpm dev`

Navigate to `/admin/notifications` in the browser. Verify:
- Page loads without errors
- Header shows "Notifications" with subtitle
- Type filter dropdown renders with all 7 options
- Table shows correct columns
- Empty state displays when no failures exist
- Nav sidebar shows "Notifications" link with bell icon in the Admin section
- Clicking the nav link navigates to the page

- [ ] **Step 4: Commit (if any fixups were needed)**

Only if prior steps required corrections.
