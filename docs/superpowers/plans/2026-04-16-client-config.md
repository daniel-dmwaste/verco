# Client Configuration Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build admin pages for contractor-admin to onboard and manage clients, sub-clients, and collection area rules.

**Architecture:** List → Detail pattern. `/admin/clients` shows a card grid, clicking opens `/admin/clients/[id]` with 6 horizontal tabs (General, Branding, Notifications, FAQs, Sub-Clients, Collection Areas). Each tab saves independently via server actions. A `/admin/clients/new` page handles initial creation with minimal required fields.

**Tech Stack:** Next.js 16 App Router, Supabase (RLS, Storage), TanStack Query v5, react-hook-form + zod, server actions.

**Design spec:** `docs/superpowers/specs/2026-04-16-client-config-design.md`

---

## Phase 1: Foundation (nav, layout, server actions, storage bucket)

### Task 1: Storage bucket migration

**Files:**
- Create: `supabase/migrations/YYYYMMDD_client_assets_bucket.sql`

- [ ] **Step 1: Create migration file**

```bash
pnpm supabase migration new client_assets_bucket
```

- [ ] **Step 2: Write migration SQL**

```sql
-- Client assets storage bucket (logos, banners)
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-assets', 'client-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for all
CREATE POLICY "client_assets_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'client-assets');

-- Authenticated users can upload
CREATE POLICY "client_assets_auth_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'client-assets');

-- Authenticated users can update their uploads
CREATE POLICY "client_assets_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'client-assets');

-- Authenticated users can delete their uploads
CREATE POLICY "client_assets_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'client-assets');
```

- [ ] **Step 3: Push migration**

```bash
pnpm supabase db push
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add client-assets storage bucket"
```

### Task 2: Add role to admin layout + sidebar

**Files:**
- Modify: `src/app/(admin)/admin/layout.tsx`
- Modify: `src/app/(admin)/admin/admin-layout-client.tsx`
- Modify: `src/components/admin/admin-sidebar.tsx`

- [ ] **Step 1: Fetch user role in layout.tsx**

Add after the profile query (around line 26):

```typescript
// Fetch user role for conditional nav rendering
const { data: userRole } = await supabase
  .from('user_roles')
  .select('role')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .single()

const role = userRole?.role ?? null
```

Pass `role` to `AdminLayoutClient`:

```tsx
<AdminLayoutClient
  clientName={clientName}
  initials={initials}
  counts={counts}
  role={role}
>
```

- [ ] **Step 2: Thread role through AdminLayoutClient**

In `admin-layout-client.tsx`, add `role` to the props interface:

```typescript
interface AdminLayoutClientProps {
  clientName: string
  initials: string
  counts: {
    bookings: number
    ncn: number
    np: number
    tickets: number
  }
  role: string | null
  children: React.ReactNode
}
```

Pass to sidebar:

```tsx
<AdminSidebar counts={counts} role={role} />
```

- [ ] **Step 3: Add Clients nav item to sidebar (contractor-admin only)**

In `admin-sidebar.tsx`:

Add icon after `auditLog`:

```typescript
clients: (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>
),
```

Add `role` to `AdminSidebarProps`:

```typescript
interface AdminSidebarProps {
  counts?: { ... }
  role?: string | null
}
```

Add a "Configuration" section at the end of the `sections` array, conditionally:

```typescript
// After the existing Admin section, add conditionally:
if (role === 'contractor-admin') {
  sections.push({
    title: 'Configuration',
    items: [
      { label: 'Clients', href: '/admin/clients', icon: ICON.clients },
    ],
  })
}
```

Note: move `sections` from `const` to `let` to allow the push.

- [ ] **Step 4: Verify build**

```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/layout.tsx src/app/\(admin\)/admin/admin-layout-client.tsx src/components/admin/admin-sidebar.tsx
git commit -m "feat: add Clients nav item for contractor-admin"
```

### Task 3: Server actions

**Files:**
- Create: `src/app/(admin)/admin/clients/actions.ts`

- [ ] **Step 1: Create all server actions**

All actions use `createClient()` (server, anon key + RLS). Use the `Result<T>` pattern (`{ ok: true, data } | { ok: false, error }`). Validate with zod schemas.

The file should contain these actions (see spec §Server Actions for the full list):
- `createClient(data)` — INSERT into `client`, setting `contractor_id` from `current_user_contractor_id()` RPC or from the `x-contractor-id` header
- `updateClient(id, data)` — UPDATE `client` fields
- `updateClientFaqs(id, items)` — UPDATE `client.faq_items` jsonb
- `createSubClient(clientId, data)` — INSERT into `sub_client`
- `updateSubClient(id, data)` — UPDATE `sub_client`
- `createCollectionArea(clientId, data)` — INSERT into `collection_area`, also setting `contractor_id` from header
- `updateCollectionArea(id, data)` — UPDATE `collection_area`
- `upsertAllocationRules(areaId, rules[])` — DELETE existing + INSERT new for the area
- `upsertServiceRules(areaId, rules[])` — DELETE existing + INSERT new for the area

Each action:
1. Reads `x-contractor-id` from `headers()` where needed
2. Validates input with a zod schema
3. Executes the Supabase mutation
4. Returns `Result<T>`

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/clients/actions.ts
git commit -m "feat: server actions for client management CRUD"
```

---

## Phase 2: Client List + Create

### Task 4: Client list page

**Files:**
- Create: `src/app/(admin)/admin/clients/page.tsx`
- Create: `src/app/(admin)/admin/clients/clients-list.tsx`

- [ ] **Step 1: Create server page**

`page.tsx` — simple Suspense wrapper:

```tsx
import { Suspense } from 'react'
import { ClientsList } from './clients-list'

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsList />
    </Suspense>
  )
}
```

- [ ] **Step 2: Create client list component**

`clients-list.tsx` — `'use client'` component using `useQuery` to fetch clients from the browser Supabase client. Follow the existing admin page pattern (header with title + count + button, then card grid).

Query:
```typescript
const { data: clients, isLoading } = useQuery({
  queryKey: ['admin-clients'],
  queryFn: async () => {
    const { data } = await supabase
      .from('client')
      .select('id, name, slug, is_active, primary_colour, collection_area(count), sub_client(count)')
      .order('name')
    return data ?? []
  },
})
```

Render a 2-column grid of cards. Each card shows:
- Initial avatar (first letter, `primary_colour` background or `#293F52` default)
- Name + slug
- Active badge
- Stats row: areas count, sub-clients count

Card is a `<Link href={/admin/clients/${client.id}}>`.

Header has a `<Link href="/admin/clients/new">+ New Client</Link>` button.

- [ ] **Step 3: Verify in browser**

Navigate to `/admin/clients` — should show existing KWN and VERCO clients.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/clients/
git commit -m "feat: client list page with card grid"
```

### Task 5: New client page

**Files:**
- Create: `src/app/(admin)/admin/clients/new/page.tsx`
- Create: `src/app/(admin)/admin/clients/new/new-client-form.tsx`

- [ ] **Step 1: Create server page**

`page.tsx` — renders the form component.

- [ ] **Step 2: Create new client form**

`new-client-form.tsx` — `'use client'` component with react-hook-form + zod.

Fields: Client Name (required), Slug (auto-generated from name via `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')`, editable), Primary Colour (default `#293F52`), Accent Colour (default `#00E47C`).

On submit: call `createClient` server action, then `router.push(/admin/clients/${result.data.id})`.

Style: match the existing admin form patterns (white card, rounded-xl, consistent input styling).

- [ ] **Step 3: Verify in browser**

Navigate to `/admin/clients/new`, fill in fields, submit. Should redirect to the new client detail page.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/clients/new/
git commit -m "feat: new client creation form"
```

---

## Phase 3: Client Detail — Tabs Shell + General Tab

### Task 6: Client detail page + tab shell

**Files:**
- Create: `src/app/(admin)/admin/clients/[id]/page.tsx`
- Create: `src/app/(admin)/admin/clients/[id]/client-detail.tsx`

- [ ] **Step 1: Create server page**

`page.tsx` — server component that fetches the full client row and passes to the client component:

```typescript
const { data: client } = await supabase
  .from('client')
  .select('*')
  .eq('id', id)
  .single()
```

Also fetch categories, services, sub-clients, and collection areas for the tabs that need them.

- [ ] **Step 2: Create client detail component**

`client-detail.tsx` — `'use client'` component with:
- Back link to `/admin/clients`
- Client header (avatar + name + slug + active badge)
- Horizontal tab bar using `useSearchParams` for `?tab=` state
- Tab content area rendering the active tab component
- Default tab: `general`

Tab definitions:
```typescript
const TABS = [
  { key: 'general', label: 'General' },
  { key: 'branding', label: 'Branding' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'faqs', label: 'FAQs' },
  { key: 'sub-clients', label: 'Sub-Clients' },
  { key: 'areas', label: 'Collection Areas' },
] as const
```

Each tab component is lazy-loaded via the active tab key. Pass the full client object + any preloaded relational data to each tab.

- [ ] **Step 3: Verify in browser**

Navigate to `/admin/clients/[id]` — should show client header + tab bar. Clicking tabs changes URL param and content area.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/clients/\[id\]/
git commit -m "feat: client detail page with tab shell"
```

### Task 7: General tab

**Files:**
- Create: `src/app/(admin)/admin/clients/[id]/tabs/general-tab.tsx`

- [ ] **Step 1: Build the General tab form**

`general-tab.tsx` — `'use client'` form with react-hook-form + zod. Three sections:

**Identity:** name, slug, service_name, custom_domain, is_active (checkbox)
**Contact:** contact_name, contact_phone, contact_email, privacy_policy_url
**Landing Page:** landing_headline, landing_subheading (textarea)

Zod schema validates slug format (lowercase alphanumeric + hyphens). Form initialised from the client prop. "Save Changes" calls `updateClient` server action. "Discard" resets to initial values via `form.reset()`.

Use the 2-column grid layout from the mockup. Section headers use `text-2xs font-semibold uppercase tracking-wide text-gray-500`.

- [ ] **Step 2: Wire into client-detail.tsx**

Import and render `<GeneralTab client={client} />` when `activeTab === 'general'`.

- [ ] **Step 3: Verify save + reload persistence**

Edit a field, save, reload — value should persist.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/clients/\[id\]/tabs/general-tab.tsx src/app/\(admin\)/admin/clients/\[id\]/client-detail.tsx
git commit -m "feat: General tab with identity, contact, landing page config"
```

---

## Phase 4: Branding + Notifications + FAQs Tabs

### Task 8: Branding tab

**Files:**
- Create: `src/app/(admin)/admin/clients/[id]/tabs/branding-tab.tsx`

- [ ] **Step 1: Build the Branding tab**

Sections:
- **Colours:** primary_colour, accent_colour — text input with inline colour swatch (`<div>` with `backgroundColor`). Validate hex format with zod.
- **Logos:** logo_light_url, logo_dark_url — file upload. Upload to `client-assets/<client_id>/logo-light-<timestamp>.<ext>` via the browser Supabase client's `.storage.from('client-assets').upload()`. Show current image if URL exists, with a "Remove" button. Display upload dropzone if no image.
- **Hero Banner:** hero_banner_url — same upload pattern, wider dropzone.
- **Display:** show_powered_by checkbox.

Save button calls `updateClient` with the URL fields. File upload happens on file select (not on form save) — the URL is written to state, then saved with the form.

- [ ] **Step 2: Wire into client-detail.tsx**

- [ ] **Step 3: Verify uploads**

Upload a logo, save, reload — logo URL persists and image renders.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/clients/\[id\]/tabs/branding-tab.tsx
git commit -m "feat: Branding tab with colour pickers and image uploads"
```

### Task 9: Notifications tab

**Files:**
- Create: `src/app/(admin)/admin/clients/[id]/tabs/notifications-tab.tsx`

- [ ] **Step 1: Build the Notifications tab**

Simple form: email_from_name, reply_to_email, sms_sender_id (maxLength 11), sms_reminder_days_before (number 1–7), email_footer_html (textarea with monospace font).

Zod validation: sms_sender_id alphanumeric max 11, sms_reminder_days_before integer 1–7.

Save calls `updateClient`.

- [ ] **Step 2: Wire into client-detail.tsx**

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/clients/\[id\]/tabs/notifications-tab.tsx
git commit -m "feat: Notifications tab for email/SMS config"
```

### Task 10: FAQs tab

**Files:**
- Create: `src/app/(admin)/admin/clients/[id]/tabs/faqs-tab.tsx`

- [ ] **Step 1: Build the FAQs tab**

Manages the `faq_items` jsonb column (array of `{ question: string, answer: string }`).

Features:
- Render ordered list of FAQ items
- Each item shows question + truncated answer, with "Edit" and "Remove" buttons
- "Edit" expands the item into inline form fields (question input + answer textarea)
- "+ Add FAQ" button appends a new empty item in edit mode
- Drag handle for reorder (optional — can use up/down arrow buttons for v1 simplicity)
- "Save Changes" calls `updateClientFaqs` with the full array

State: local `useState` array of FAQ items, initialised from client.faq_items.

- [ ] **Step 2: Wire into client-detail.tsx**

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/clients/\[id\]/tabs/faqs-tab.tsx
git commit -m "feat: FAQs tab with inline editing and reorder"
```

---

## Phase 5: Sub-Clients + Collection Areas Tabs

### Task 11: Sub-Clients tab

**Files:**
- Create: `src/app/(admin)/admin/clients/[id]/tabs/sub-clients-tab.tsx`

- [ ] **Step 1: Build the Sub-Clients tab**

Table of sub-clients with columns: Name, Code, Areas (count from preloaded data), Status, Actions.

Features:
- Fetch sub-clients via `useQuery` (browser client, scoped by client_id)
- "+ Add Sub-Client" button shows inline form row at top of table (Name + Code inputs + Save/Cancel)
- Clicking a row toggles inline edit mode
- "Deactivate" button toggles `is_active`
- **Warning:** If a sub-client has 0 areas, show amber "No areas configured" badge

Actions call: `createSubClient`, `updateSubClient`.

- [ ] **Step 2: Wire into client-detail.tsx**

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/clients/\[id\]/tabs/sub-clients-tab.tsx
git commit -m "feat: Sub-Clients tab with inline CRUD"
```

### Task 12: Collection Areas tab

**Files:**
- Create: `src/app/(admin)/admin/clients/[id]/tabs/collection-areas-tab.tsx`

- [ ] **Step 1: Build the Collection Areas tab**

This is the most complex tab. Two layers: area list + area rules config.

**Area list table:** Code, Name, Sub-Client (dropdown label or "—"), Properties count, Allocation status ("Configured"/"Not Set"), Active badge.

**"+ Add Area" form:** Code (required), Name (required), Sub-Client (optional dropdown of this client's sub-clients), DM Job Code (optional). Calls `createCollectionArea`.

**Area rules panel:** Clicking an area row expands an inline section below showing:

- **Allocation Rules section:** One row per `category` (fetch from `category` table). Each row: category name + `max_collections` number input. Pre-populated from existing `allocation_rules` for this area.

- **Service Rules section:** One row per `service` (fetch from `service` table, grouped by category). Each row: service name + `max_collections` number input + `extra_unit_price` currency input. Pre-populated from existing `service_rules` for this area.

- "Save Rules" button calls `upsertAllocationRules` + `upsertServiceRules`.

Data fetching: `useQuery` for areas (with nested counts), separate queries for categories + services. Rules fetched when area is expanded.

- [ ] **Step 2: Wire into client-detail.tsx**

- [ ] **Step 3: Verify full flow**

Add an area → configure allocation + service rules → save → reload → verify rules persist. Verify the pricing engine uses these rules by testing a booking in that area.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/clients/\[id\]/tabs/collection-areas-tab.tsx
git commit -m "feat: Collection Areas tab with allocation and service rules"
```

---

## Phase 6: Verification + Cleanup

### Task 13: Build verification and final review

- [ ] **Step 1: Run full build**

```bash
pnpm build
```

Fix any type errors.

- [ ] **Step 2: Test access control**

- Log in as contractor-admin → "Clients" nav visible, all pages accessible
- Log in as client-admin → "Clients" nav NOT visible, `/admin/clients` should still be accessible via URL (RLS scopes the data, proxy allows admin roles)

- [ ] **Step 3: Test full onboarding flow**

1. Navigate to `/admin/clients` → see existing clients
2. Click "+ New Client" → fill required fields → save
3. Redirected to detail page → configure each tab
4. Upload a logo in Branding tab → verify it persists
5. Add a sub-client → verify it appears with "No areas" warning
6. Add a collection area linked to the sub-client → warning disappears
7. Configure allocation + service rules on the area → save → reload → verify persistence

- [ ] **Step 4: Push migration**

```bash
pnpm supabase db push
```

- [ ] **Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: client configuration pages for contractor-admin onboarding"
```
