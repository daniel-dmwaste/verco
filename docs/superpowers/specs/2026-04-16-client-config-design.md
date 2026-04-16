# Client & Sub-Client Configuration Pages

**Date:** 2026-04-16
**Status:** Design approved
**Scope:** New admin pages for contractor-admin to onboard and manage clients

---

## Context

Verco is a multi-tenant SaaS platform where a contractor (D&M Waste) manages multiple clients (LGAs). Currently there is no UI for creating or configuring clients — all setup is done via database inserts. This feature adds a full client management UI for the `contractor-admin` role, serving both initial onboarding and ongoing configuration updates.

## Routes

| Route | Purpose |
|---|---|
| `/admin/clients` | Client list — card grid of all clients under the contractor |
| `/admin/clients/new` | New client form — required fields only, redirects to detail on save |
| `/admin/clients/[id]` | Client detail — tabbed config page for all settings |

## Access Control

- **Visible to:** `contractor-admin` only (not `client-admin`, `client-staff`, `contractor-staff`)
- **RLS:** Existing policies on `client` table already scope to `contractor_id = current_user_contractor_id()`. INSERT/UPDATE policies exist for contractor-tier users.
- **Proxy:** No changes needed — `/admin/*` routes are already guarded for admin roles. The UI conditionally renders the nav item and pages based on `contractor-admin` role check.

## Page 1: Client List (`/admin/clients`)

### Layout
- Standard admin page header: "Clients" title + count
- "+ New Client" button top-right
- 2-column card grid of clients

### Client Card
Each card shows:
- Client initial avatar (first letter of name, coloured with `primary_colour` or default navy)
- Client name + slug
- Active/Inactive badge
- Summary stats: collection areas count, properties count, sub-clients count, bookings count (current FY)

Clicking a card navigates to `/admin/clients/[id]`.

### Data Fetching
Client component with `useQuery`. Query:
```
client(id, name, slug, is_active, primary_colour,
  collection_area(count),
  sub_client(count),
  booking(count)  -- filtered to current FY
)
```

## Page 2: Client Detail (`/admin/clients/[id]`)

### Layout
- Back link: "← Back to Clients"
- Client avatar + name + slug + status
- Horizontal tab bar: **General**, **Branding**, **Notifications**, **FAQs**, **Sub-Clients**, **Collection Areas**
- Each tab is a form section with independent "Save Changes" / "Discard" buttons
- Tab state managed via URL search param (`?tab=branding`) for shareability

### Tab: General

**Identity section:**
- Client Name * (text input)
- Slug * (text input, validated: lowercase alphanumeric + hyphens, unique)
- Service Name (text input — displayed on the public portal)
- Custom Domain (text input, nullable)
- Active toggle (checkbox)

**Contact section:**
- Contact Name (text)
- Contact Phone (text)
- Contact Email (email)
- Privacy Policy URL (url)

**Landing Page Copy section:**
- Headline (text)
- Subheading (textarea)

### Tab: Branding

**Colours section:**
- Primary Colour (hex input with colour swatch preview)
- Accent Colour (hex input with colour swatch preview)

**Logos section:**
- Logo (Light Background) — file upload, PNG/SVG, max 2MB
- Logo (Dark Background) — file upload, PNG/SVG, max 2MB
- Hero Banner Image — file upload, recommended 1920×600

**Display section:**
- Show "Powered by VERCO" badge (checkbox)

Logo/image uploads go to Supabase Storage bucket `client-assets` (new bucket, public read). Path convention: `client-assets/<client_id>/<filename>`. URLs stored in `logo_light_url`, `logo_dark_url`, `hero_banner_url` columns.

### Tab: Notifications

- Email From Name (text)
- Reply-To Email (email)
- SMS Sender ID (text, max 11 chars alphanumeric)
- SMS Reminder Days Before (number, 1–7)
- Email Footer HTML (textarea/code editor)

### Tab: FAQs

- Ordered list of FAQ items (from `faq_items` jsonb column)
- Each item: question (text) + answer (textarea)
- Drag to reorder
- Add / Edit / Remove actions
- Inline editing (click "Edit" to expand into form fields)

### Tab: Sub-Clients

- Table: Name, Code, Areas (count), Status (active/inactive), Actions (edit/deactivate)
- "+ Add Sub-Client" button opens inline row or modal with Name + Code fields
- Code must be unique per client (enforced by DB constraint)
- Edit is inline (click row to edit name/code/status)
- **Warning indicator:** If a sub-client has zero collection areas, show "No areas configured" in amber — every sub-client should have at least one area to define its allocation/service rules
- **Design rule:** Allocation/service rules live on collection areas, not sub-clients. Each sub-client gets one or more areas (with `sub_client_id` set) — even if it's a single area covering all their properties.

### Tab: Collection Areas

- Table: Code, Name, Sub-Client (or "—"), Properties count, Allocation Rules status ("Configured"/"Not Set"), Active status
- "+ Add Area" button opens form with: Code *, Name *, Sub-Client (optional dropdown), DM Job Code (optional)
- Clicking an area row opens an expandable section or modal showing:
  - **Allocation Rules:** one row per category (Bulk, Ancillary, ID) with `max_collections` input
  - **Service Rules:** one row per service type with `max_collections` + `extra_unit_price` inputs
- Area rules are saved independently from the area itself

## Page 3: New Client (`/admin/clients/new`)

Minimal form with required fields only:
- Client Name *
- Slug * (auto-generated from name, editable)
- Primary Colour (defaults to `#293F52`)
- Accent Colour (defaults to `#00E47C`)

On save: creates client row with `contractor_id` from the current user's contractor, redirects to `/admin/clients/[id]` for full configuration.

## Navigation

Add "Clients" nav item to the admin sidebar under a new "Configuration" section (after "Admin" section). Only visible to `contractor-admin` role.

```
CONFIGURATION (contractor-admin only)
  Clients
```

Icon: building/office icon (Lucide `Building2` or similar).

## Server Actions

All mutations via server actions in `app/(admin)/admin/clients/actions.ts`:

| Action | Purpose |
|---|---|
| `createClient(data)` | Insert new client |
| `updateClient(id, data)` | Update client fields (General, Branding, Notifications tabs) |
| `updateClientFaqs(id, items)` | Replace FAQ jsonb array |
| `createSubClient(clientId, data)` | Insert sub-client |
| `updateSubClient(id, data)` | Update sub-client |
| `createCollectionArea(clientId, data)` | Insert collection area |
| `updateCollectionArea(id, data)` | Update collection area |
| `upsertAllocationRules(areaId, rules)` | Upsert allocation rules for an area |
| `upsertServiceRules(areaId, rules)` | Upsert service rules for an area |

All actions use the server Supabase client (anon key + RLS). No service role key.

## Storage

New Supabase Storage bucket: `client-assets`
- Public read (logos/banners displayed on public pages)
- Authenticated write (contractor-admin uploads)
- Path: `<client_id>/<type>-<timestamp>.<ext>` (e.g. `b009e60a.../logo-light-1713234567.png`)
- Max file size: 2MB for logos, 5MB for hero banner

## Schema Changes

None — all columns already exist on `client`, `sub_client`, `collection_area`, `allocation_rules`, and `service_rules` tables. Only the storage bucket is new.

## Migration

One migration:
1. Create `client-assets` storage bucket with public read + authenticated write policies

## Files to Create

| File | Purpose |
|---|---|
| `src/app/(admin)/admin/clients/page.tsx` | Client list server page |
| `src/app/(admin)/admin/clients/clients-list.tsx` | Client list client component |
| `src/app/(admin)/admin/clients/new/page.tsx` | New client page |
| `src/app/(admin)/admin/clients/new/new-client-form.tsx` | New client form |
| `src/app/(admin)/admin/clients/[id]/page.tsx` | Client detail server page |
| `src/app/(admin)/admin/clients/[id]/client-detail.tsx` | Client detail client component (tabs) |
| `src/app/(admin)/admin/clients/[id]/tabs/general-tab.tsx` | General tab form |
| `src/app/(admin)/admin/clients/[id]/tabs/branding-tab.tsx` | Branding tab form |
| `src/app/(admin)/admin/clients/[id]/tabs/notifications-tab.tsx` | Notifications tab form |
| `src/app/(admin)/admin/clients/[id]/tabs/faqs-tab.tsx` | FAQs tab |
| `src/app/(admin)/admin/clients/[id]/tabs/sub-clients-tab.tsx` | Sub-clients tab |
| `src/app/(admin)/admin/clients/[id]/tabs/collection-areas-tab.tsx` | Collection areas tab |
| `src/app/(admin)/admin/clients/actions.ts` | Server actions |
| `supabase/migrations/YYYYMMDD_client_assets_bucket.sql` | Storage bucket migration |

## Files to Modify

| File | Change |
|---|---|
| `src/components/admin/admin-sidebar.tsx` | Add "Clients" nav item under new "Configuration" section, conditionally visible for contractor-admin |
| `src/app/(admin)/admin/admin-layout-client.tsx` | Pass user role to sidebar for conditional rendering |
| `src/app/(admin)/admin/layout.tsx` | Fetch and pass user role |

## Verification

1. `pnpm build` — no type errors
2. Log in as contractor-admin → see "Clients" in sidebar
3. Client list shows existing clients with correct stats
4. Create new client → verify it appears in the list
5. Edit each tab → save → reload → verify persistence
6. Upload logos/banner → verify they render on the public portal
7. Add sub-client → verify unique code constraint
8. Add collection area → configure allocation/service rules → verify pricing engine uses them
9. Log in as client-admin → verify "Clients" nav is NOT visible
