# Audit Trail — Inline Change History for Admin Detail Pages

**Date:** 2026-04-16
**Status:** Draft
**Author:** Claude (with Dan Taylor)

---

## Context

Admin staff need visibility into who changed what and when on key records. The `audit_log` table already exists in the schema but is barely used — only 2 Edge Functions write to it (create-user, create-ticket), and only the booking detail page reads from it with a minimal display (raw action text + timestamp, no diffs, no actor names, no human-readable labels).

**Goal:** Automatically capture all changes to key tables via a Postgres trigger, then display them as human-readable, expandable audit timelines inline on admin detail pages.

---

## Scope

### Tables with audit triggers

| Table | Detail page | Notes |
|---|---|---|
| `booking` | `/admin/bookings/[id]` | Status changes, contact/location edits, notes |
| `booking_item` | (shown on booking detail) | Service additions/removals, date changes |
| `non_conformance_notice` | `/admin/non-conformance/[id]` | Status transitions, resolution, rebook |
| `nothing_presented` | `/admin/nothing-presented/[id]` | Status transitions, rebook |
| `service_ticket` | `/admin/service-tickets/[id]` | Status changes, assignment, responses |
| `ticket_response` | (shown on ticket detail) | New responses |
| `collection_date` | `/admin/collection-dates` | Open/close, date changes |
| `strata_user_properties` | `/admin/properties/[id]` | MUD property link changes |
| `contacts` | (shown on booking detail) | Name/email/phone edits |
| `eligible_properties` | `/admin/properties/[id]` | Address or area reassignment |

### Tables explicitly excluded

- `profiles`, `user_roles` — already logged by create-user EF; sensitive auth data
- `booking_payment` — financial records have separate Stripe audit trail
- `allocation_rules`, `service_rules` — configuration changes are low-frequency and low-risk
- `sync_log`, `notification_log`, `bug_report` — system/operational tables

---

## Architecture

### Layer 1: Capture — Postgres Audit Trigger

A single trigger function attached to all target tables.

```sql
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_old jsonb := NULL;
  v_new jsonb := NULL;
  v_record_id uuid;
  v_client_id uuid := NULL;
  v_contractor_id uuid := NULL;
BEGIN
  -- Capture old/new as JSONB
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW);
  END IF;

  -- Derive record ID
  v_record_id := COALESCE(NEW.id, OLD.id);

  -- Derive client_id (most tables have it directly)
  IF v_new IS NOT NULL AND v_new ? 'client_id' THEN
    v_client_id := (v_new->>'client_id')::uuid;
  ELSIF v_old IS NOT NULL AND v_old ? 'client_id' THEN
    v_client_id := (v_old->>'client_id')::uuid;
  END IF;

  -- Derive contractor_id
  IF v_new IS NOT NULL AND v_new ? 'contractor_id' THEN
    v_contractor_id := (v_new->>'contractor_id')::uuid;
  ELSIF v_old IS NOT NULL AND v_old ? 'contractor_id' THEN
    v_contractor_id := (v_old->>'contractor_id')::uuid;
  END IF;

  -- For child tables (booking_item, ticket_response, contacts), resolve client_id via parent
  -- This is handled by looking up the parent row if client_id is not on the row itself.
  -- For booking_item: JOIN booking ON booking.id = NEW.booking_id
  -- For ticket_response: JOIN service_ticket ON service_ticket.id = NEW.ticket_id
  -- For contacts: client_id resolved via booking or direct FK

  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, client_id, contractor_id)
  VALUES (TG_TABLE_NAME, v_record_id, TG_OP, v_old, v_new, auth.uid(), v_client_id, v_contractor_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Trigger attachment** (one per target table):
```sql
CREATE TRIGGER audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON booking
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
-- Repeat for each target table
```

**Skip noise updates:** The trigger captures `updated_at` changes but the display layer filters these out. We do NOT filter at the trigger level because compliance requires the full snapshot.

**Interaction with existing EF audit inserts:** The `create-ticket` and `create-user` EFs currently insert audit entries manually. Once triggers are active on `service_ticket`, the trigger will capture the INSERT automatically. We remove the manual insert from `create-ticket` to avoid duplicates. `create-user` logs against `user_roles` which is NOT in our trigger scope, so it stays.

### Layer 2: Resolution — Server-Side UUID → Label Mapping

**File:** `src/lib/audit/resolve.ts`

This module:

1. **Diffs old_data vs new_data** — produces `{ field, oldValue, newValue }[]` for each entry, skipping unchanged fields
2. **Maps column names to labels** via a static dictionary:
   ```ts
   const FIELD_LABELS: Record<string, string> = {
     status: 'Status',
     collection_area_id: 'Collection Area',
     contact_id: 'Contact',
     service_id: 'Service',
     collection_date_id: 'Collection Date',
     property_id: 'Property',
     location: 'Location',
     notes: 'Notes',
     reason: 'Reason',
     resolution_notes: 'Resolution Notes',
     contractor_fault: 'Contractor Fault',
     no_services: 'Quantity',
     unit_price_cents: 'Unit Price',
     is_extra: 'Extra Item',
     full_name: 'Name',
     email: 'Email',
     mobile_e164: 'Mobile',
     is_open: 'Open for Bookings',
     date: 'Date',
     // ... extend as needed
   }
   ```
3. **Resolves FK UUIDs to display names** — batch query approach:
   ```ts
   // Collect all unique UUIDs per FK column from all audit entries
   // Query each referenced table once:
   //   service_id    → service.name
   //   collection_area_id → collection_area.name
   //   contact_id    → contacts.full_name
   //   collection_date_id → collection_date.date
   //   property_id   → eligible_properties.formatted_address
   //   changed_by    → profiles.display_name
   //
   // Build a lookup map: { [uuid]: displayLabel }
   // Replace UUIDs in diff values with resolved labels
   // Fallback: "Unknown" if UUID not found (deleted record)
   ```
4. **Generates action summary** from the operation + key field changes:
   - `INSERT` → "Created"
   - `DELETE` → "Deleted"
   - `UPDATE` with `status` change → "Status changed to {newStatus}"
   - `UPDATE` with `is_open` change → "Bookings {opened/closed}"
   - `UPDATE` other → "{N} fields updated"
5. **Filters noise fields** from the diff display: `id`, `created_at`, `updated_at`, `client_id`, `contractor_id`, `fy_id`

**Type signature:**
```ts
interface ResolvedAuditEntry {
  id: string
  action: string           // e.g. "INSERT", "UPDATE", "DELETE"
  summary: string          // Human-readable: "Status changed to Confirmed"
  actorName: string | null // "Jane Smith" or null for system actions
  createdAt: string        // ISO timestamp
  changes: {
    field: string          // Human label: "Status"
    oldValue: string | null
    newValue: string | null
  }[]
}

export async function resolveAuditLogs(
  supabase: SupabaseClient,
  tableName: string,
  recordId: string,
  options?: { includeChildren?: { table: string; fkColumn: string }[] }
): Promise<ResolvedAuditEntry[]>
```

The `includeChildren` option allows fetching audit entries for related child records. For example, on the booking detail page:
```ts
const logs = await resolveAuditLogs(supabase, 'booking', bookingId, {
  includeChildren: [
    { table: 'booking_item', fkColumn: 'booking_id' },
    { table: 'contacts', fkColumn: 'id' }, // resolved via booking.contact_id
  ]
})
```

### Layer 3: Display — `<AuditTimeline>` Component

**File:** `src/components/audit-timeline.tsx`

A reusable client component that renders the resolved audit entries.

**Visual design:**
```
─────────────────────────────────────────
  Activity
─────────────────────────────────────────
● Status changed to Confirmed        Jane Smith
  16 Apr 2026, 2:35pm
  ▶ Show changes (2 fields)

● Created                            System
  15 Apr 2026, 10:12am
  ▶ Show changes (8 fields)
─────────────────────────────────────────
```

Expanded state:
```
● Status changed to Confirmed        Jane Smith
  16 Apr 2026, 2:35pm
  ▼ Hide changes
    Status: Submitted → Confirmed
    Updated At: (hidden — noise field)
```

**Props:**
```ts
interface AuditTimelineProps {
  entries: ResolvedAuditEntry[]
  maxVisible?: number  // Default 10, "Show more" button for older entries
}
```

**Styling:**
- Follows existing booking detail section pattern: `border-b border-gray-100 px-5 py-4`
- Section header: `text-2xs font-semibold uppercase tracking-wide text-gray-500` → "Activity"
- Dot timeline with `bg-gray-300` dots (existing pattern)
- Expand toggle uses `text-[11px] text-brand cursor-pointer`
- Field diffs in `text-[11px] text-gray-600` with `→` separator

**Special formatting:**
- `unit_price_cents`: format as `$X.XX` (divide by 100)
- `contractor_fault`: show as "Yes" / "No"
- `is_extra`: show as "Yes" / "No"
- `date` fields: format as `d MMM yyyy`
- `is_open`: show as "Open" / "Closed"

---

## RLS Changes

Current policy (`audit_log_select`):
```sql
USING (
  client_id IN (SELECT accessible_client_ids())
  AND (has_role('client-admin') OR has_role('contractor-admin'))
)
```

Updated to include staff roles:
```sql
USING (
  client_id IN (SELECT accessible_client_ids())
  AND current_user_role() IN ('client-admin', 'client-staff', 'contractor-admin', 'contractor-staff')
)
```

**Note:** `field` and `ranger` roles remain excluded — audit logs may contain PII (contact name changes, email changes) which these roles must never see per CLAUDE.md §4.

---

## Migration Plan

**Single migration file:** `supabase/migrations/YYYYMMDD_audit_trigger.sql`

Contents:
1. `audit_trigger_fn()` function
2. Triggers on all 10 target tables
3. Updated `audit_log_select` RLS policy (DROP + CREATE)
4. Index: `CREATE INDEX IF NOT EXISTS idx_audit_log_table_record_created ON audit_log(table_name, record_id, created_at DESC)` — optimises the detail page query pattern

---

## Detail Page Integration

Each detail page's server component (`page.tsx`) calls `resolveAuditLogs()` and passes the result to its client component, which renders `<AuditTimeline>`.

| Page | Parent table | Children |
|---|---|---|
| Booking detail | `booking` | `booking_item`, `contacts` (via booking.contact_id) |
| NCN detail | `non_conformance_notice` | — |
| NP detail | `nothing_presented` | — |
| Service ticket detail | `service_ticket` | `ticket_response` |
| Collection dates | `collection_date` | — |
| Property detail | `eligible_properties` | `strata_user_properties` |

**Collection dates** don't currently have a detail page. Options:
- Add a slide-out panel or dialog on the collection dates list page
- Or add audit entries inline in each row's expanded view

We'll use a dialog/drawer triggered from the list — consistent with how the allocation form modal works.

---

## Edge Cases

1. **Deleted records** — if a referenced UUID (e.g. old service_id) points to a deleted service, the resolver falls back to `"Unknown"` rather than showing a naked UUID
2. **System actions** (cron, webhooks) — `auth.uid()` is null for service-role operations. Display as "System" instead of a name
3. **Bulk updates** — if a cron updates 200 bookings from Confirmed → Scheduled, that's 200 audit entries. The trigger captures them all. The display limits to 10 most recent with a "Show more" button
4. **Large JSONB payloads** — `row_to_json` captures the full row. For tables with large `photos` (jsonb array on NCN) or `address` (jsonb on eligible_properties), this could bloat audit_log. We add a pre-insert strip of known large fields: `photos`, `geom` columns are set to `'[stripped]'` in the trigger
5. **Existing manual audit inserts** — the `create-ticket` EF manually inserts an audit row. Once the trigger is active on `service_ticket`, this would create a duplicate. Remove the manual insert from `create-ticket`
6. **Contacts table has no client_id** — the trigger can't derive tenant scoping for contact changes. This is acceptable because contact edits only happen from the booking detail page. The resolver fetches contact audit entries via the booking's `contact_id`, not by `client_id` on the audit_log row. The `client_id` column on these audit_log rows will be NULL — the RLS policy needs an OR clause for entries fetched by `record_id` match when `client_id` is NULL (or we populate `client_id` in the trigger by looking up the booking)

---

## Verification

1. **Trigger test:** Make a booking status change via the admin UI → check `audit_log` table has a new row with correct `old_data`/`new_data`
2. **Resolution test:** Verify UUID fields in audit entries resolve to human-readable labels on the booking detail page
3. **Diff display test:** Edit a booking's contact name → expand the audit entry → verify "Name: Old Name → New Name" appears
4. **RLS test:** Log in as `client-staff` → verify audit trail is visible. Log in as `field` → verify audit trail section is not shown
5. **System action test:** Wait for the Confirmed→Scheduled cron to run → verify audit entry shows "System" as the actor
6. **Performance test:** Load a booking with 20+ audit entries → verify page loads in < 2s

---

## Files to Create/Modify

**New files:**
- `supabase/migrations/YYYYMMDD_audit_trigger.sql`
- `src/lib/audit/resolve.ts`
- `src/lib/audit/field-labels.ts`
- `src/components/audit-timeline.tsx`

**Modified files:**
- `src/app/(admin)/admin/bookings/[id]/page.tsx` — replace raw audit fetch with `resolveAuditLogs()`
- `src/app/(admin)/admin/bookings/[id]/booking-detail-panel.tsx` — replace inline audit section with `<AuditTimeline>`
- `src/app/(admin)/admin/non-conformance/[id]/page.tsx` — add audit log fetch
- `src/app/(admin)/admin/non-conformance/[id]/ncn-detail-client.tsx` — add `<AuditTimeline>`
- `src/app/(admin)/admin/nothing-presented/[id]/page.tsx` — add audit log fetch
- `src/app/(admin)/admin/nothing-presented/[id]/np-detail-client.tsx` — add `<AuditTimeline>`
- `src/app/(admin)/admin/service-tickets/[id]/page.tsx` — add audit log fetch (if detail page exists) or service-tickets list page
- `src/app/(admin)/admin/service-tickets/[id]/admin-ticket-detail-client.tsx` — add `<AuditTimeline>`
- `src/app/(admin)/admin/collection-dates/collection-dates-client.tsx` — add audit dialog
- `src/app/(admin)/admin/properties/[id]/page.tsx` — add audit log fetch
- `src/app/(admin)/admin/properties/[id]/property-detail-client.tsx` — add `<AuditTimeline>`
- `supabase/functions/create-ticket/index.ts` — remove manual audit_log insert (trigger handles it)
