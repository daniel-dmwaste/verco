# CLAUDE.md — Verco v2

This file is read automatically at the start of every Claude Code session.
Do not delete or rename it. Keep it up to date as decisions change.

---

## 1. What This Project Is

**Verco** is a white-labelled, multi-tenant SaaS platform for managing residential bulk verge collection bookings on behalf of WA local governments.

- **Operator:** D&M Waste Management (Safety Bay WA)
- **Companion app:** DM-Ops (separate repo, separate Supabase project)
- **Full spec:** See `docs/VERCO_V2_PRD.md` and `docs/VERCO_V2_TECH_SPEC.md`

---

## 2. Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server components, server actions, proxy |
| Language | TypeScript 5 — strict mode ON | `strict: true` in tsconfig — no exceptions |
| Styling | Tailwind CSS 4 | Utility classes preferred; inline styles for layout where Tailwind isn't rendering |
| UI | shadcn/ui (Radix primitives) | `components/ui/` — never edit these files |
| Forms | react-hook-form + zod | All forms use zod schemas for validation |
| Server state | TanStack Query v5 | All async data fetching |
| Backend | Supabase (separate AU project) | ap-southeast-2 |
| Auth | Supabase Auth — email OTP only | No passwords, no OAuth |
| Payments | Stripe | Single D&M account |
| Package manager | pnpm | Never use npm or yarn |
| Testing | Vitest + Testing Library + Playwright | Unit + E2E |
| Fonts | Poppins + DM Sans via next/font/google | `--font-poppins` (headings), `--font-dm-sans` (body/sans) |
| Maps | Leaflet via `dynamic(() => ..., { ssr: false })` | OpenStreetMap tiles; coerce Postgres `numeric` → `Number()` |
| Hosting | Coolify on BinaryLane | Node container — no edge runtime |

---

## 3. Entity Hierarchy

Always think in this hierarchy. Every feature touches one or more of these levels:

```
Contractor          e.g. D&M Waste Management
  └── Client        e.g. City of Kwinana, WMRC (Verge Valet)
        └── Sub-client   e.g. City of Cockburn (COT) under WMRC — nullable
              └── Collection Area   e.g. KWN-1, VV-COT — the atomic booking unit
                    └── Eligible Property   e.g. 23 Leda Blvd, Wellard
                          └── Booking

Category (Bulk / Ancillary / Illegal Dumping)
  └── Service (General, Green, Mattress, E-Waste, Whitegoods)
```

**Schema naming:**
- `category` table = capacity grouping: Bulk, Ancillary, Illegal Dumping (has `code` column: 'bulk', 'anc', 'id')
- `service` table = individual service types: General, Green, Mattress, E-Waste, Whitegoods (FK `category_id` → category)
- `allocation_rules` = per collection_area per category (max collections per FY)
- `service_rules` = per collection_area per service (max collections + overage price)
- `booking_item.service_id` → FK to `service` table (not `service_type`)
- `allocation_override` = per property per FY per service admin grant of `extra_allocations` (used by both SUD and MUD allowance bumps; reuses existing UI to be built)

**MUD scaffolding on `eligible_properties`:** `is_mud`, `unit_count`, `mud_code`, `mud_onboarding_status` enum (`Contact Made` / `Registered` / `Inactive`), `collection_cadence` enum (`Ad-hoc` / `Annual` / `Bi-annual` / `Quarterly`), `waste_location_notes`, `auth_form_url`, `strata_contact_id` → contacts. View `v_mud_next_expected` computes cadence-based reminder dates for Registered MUDs only. Storage bucket `mud-auth-forms` (private, 10 MB cap, PDF/JPG/PNG/HEIC) holds signed authorisation form uploads. CHECK constraints enforce `is_mud=true` requires `unit_count >= 8`, status set, cadence set; `Registered` requires strata_contact + auth_form + waste_location_notes all present.

**Key rules:**
- A resident portal is branded at the **client** level (e.g. `kwn.verco.au`)
- Address lookup resolves to a **collection area** — never ask the resident to select one
- Sub-clients are optional — KWN has none, WMRC has nine
- `dm_job_code` on `collection_area` is a metadata field for DM-Ops sync only — never use it for business logic

---

## 4. Role Model

Eight roles. Scope is enforced at the DB level via RLS — never rely on frontend-only checks.

| Role | Tier | Scope |
|---|---|---|
| `contractor-admin` | Contractor | All clients under their contractor |
| `contractor-staff` | Contractor | All clients — limited write |
| `field` | Contractor | Run sheet + closeout — **zero PII** |
| `client-admin` | Client | Own client + sub-clients |
| `client-staff` | Client | Own client + sub-clients — limited write |
| `ranger` | Client | Own areas — **zero PII** |
| `resident` | End user | Own bookings only |
| `strata` | End user | Authorised MUD properties only |

**PII rule — absolute, no exceptions:**
`field` and `ranger` roles receive **zero** contact information. This means:
- Never query `contacts.full_name`, `contacts.email`, or `contacts.mobile_e164` in any code path accessible to these roles
- The run sheet RPC (`get_run_sheet`) structurally excludes these fields — do not add them
- This is enforced at RLS level AND in query structure — defence in depth

---

## 5. Supabase Client Usage

**This is the most common source of bugs. Read carefully.**

There are two Supabase clients. Use the right one for the context:

### Server client (server components, server actions, API routes)
```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
```

### Browser client (client components only)
```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### Rules
- **Always use the anon key** in both clients — RLS does the access control
- **Never use the service role key** in any client-side or server component code
- Service role key is used **only** in Edge Functions where bypassing RLS is explicitly required (e.g. `nightly-sync-to-dm-ops`)
- Never import the service role key into Next.js app code — it must stay in `supabase/functions/`
- Use `createClient` from `lib/supabase/server.ts` in:
  - `app/**/page.tsx` (server components)
  - `app/**/layout.tsx`
  - `app/api/**/route.ts`
  - Server actions (`'use server'`)
- Use `createClient` from `lib/supabase/client.ts` in:
  - Files with `'use client'` directive
  - Custom hooks in `hooks/`

---

## 6. Pricing Engine — Hard Rules

**The most security-critical part of the codebase.**

```
NEVER accept unit_price_cents from the client.
NEVER calculate price in a client component.
NEVER skip the server-side price recalculation on booking creation.
```

The pricing flow is always:
1. Client calls `calculate-price` Edge Function with `{ property_id, fy_id, items }`
2. Edge Function returns `PriceCalculationResult` — client displays this to the user
3. On confirm, client calls `create-booking` Edge Function
4. `create-booking` **re-runs** `calculatePrice` internally — it never trusts the client's displayed price
5. If the recalculated price differs from what was shown, the booking is rejected

### Dual-limit free unit calculation

A unit becomes paid (extra) when EITHER limit is exhausted:

```
category_remaining = allocation_rules.max_collections - FY usage across ALL services in that category
service_remaining  = service_rules.max_collections - FY usage for THIS specific service
free_units         = MIN(requested_qty, category_remaining, service_remaining)
paid_units         = requested_qty - free_units
```

**Only free_units consume category budget** — paid units do not reduce the remaining count. When iterating multiple services in the same category, track cumulative free unit consumption with a `categoryFormUsed` map.

The authoritative implementation is in `supabase/functions/_shared/pricing.ts`. A Node-compatible extraction lives in `src/lib/pricing/calculate.ts` (tested with Vitest, keep in sync). The client-side preview in `services-form.tsx` mirrors the same logic for display purposes only.

---

## 7. Booking State Machine — Hard Rules

Valid transitions only. The DB trigger `enforce_booking_state_transition` will reject invalid transitions — but never try to force one from application code either.

```
Pending Payment → Submitted       (Stripe webhook only)
Pending Payment → Cancelled       (system: payment expired)
Submitted       → Confirmed       (client-admin, client-staff, contractor-*)
Submitted       → Cancelled       (any staff role or resident pre-cutoff)
Confirmed       → Scheduled       (cron: 3:25pm AWST daily — never manual)
Confirmed       → Cancelled       (any staff role pre-cutoff)
Scheduled       → Completed       (field role only)
Scheduled       → Non-conformance (field role only)
Scheduled       → Nothing Presented (field role only)
Scheduled       → Cancelled       (any staff role pre-cutoff)
Non-conformance → Rebooked        (client-admin, contractor-*)
Nothing Presented → Rebooked      (client-admin, contractor-*)
```

**Never directly set `status = 'Scheduled'` from application code.** The cron handles this.

**Cancellation cutoff:** 3:30pm AWST the day prior to collection. The DB trigger `enforce_cancellation_cutoff` rejects violations — but always check `can_cancel_booking()` RPC before showing the cancel UI.

---

## 8. TypeScript Conventions

### Strict mode — always on
```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true
  }
}
```

### Never use `any`
```typescript
// ✗ Never
const data: any = await supabase.from('booking').select('*')

// ✓ Always use generated types
import type { Database } from '@/lib/supabase/types'
type Booking = Database['public']['Tables']['booking']['Row']
```

### Regenerate types after every migration
```bash
pnpm supabase gen types typescript --project-id $PROJECT_ID > lib/supabase/types.ts
```

### Zod schemas for all external inputs
```typescript
// Every API route, server action, and Edge Function input is validated with zod
import { z } from 'zod'

const CreateBookingSchema = z.object({
  property_id:  z.string().uuid(),
  items:        z.array(BookingItemSchema).min(1).max(20),
  contact:      ContactSchema,
  location:     z.string().min(1).max(100),
  notes:        z.string().max(500).optional(),
})
```

### Result pattern for error handling
```typescript
// Use a consistent Result type — never throw across async boundaries
type Result<T, E = string> =
  | { ok: true;  data: T }
  | { ok: false; error: E }

// Usage
async function createBooking(input: unknown): Promise<Result<{ ref: string }>> {
  const parsed = CreateBookingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }
  // ...
  return { ok: true, data: { ref: booking.ref } }
}
```

---

## 9. File & Folder Conventions

### Naming
- **Files:** `kebab-case.tsx` / `kebab-case.ts`
- **Components:** `PascalCase` named export
- **Hooks:** `useCamelCase` — always prefix with `use`
- **Server actions:** `camelCase` in `app/**/actions.ts`
- **Utilities:** `camelCase` in `lib/utils/`

### Component co-location
Keep components close to where they're used. Only promote to `components/` when used in 3+ places.

```
app/
  (public)/
    book/
      services/
        page.tsx
        service-selector.tsx      ← co-located, used only here
        use-service-rules.ts      ← co-located hook
components/
  booking/
    booking-status-badge.tsx      ← shared, used in admin + resident views
```

### Server vs. client components
Default to **server components**. Add `'use client'` only when you need:
- `useState` / `useReducer`
- `useEffect`
- Browser APIs (geolocation, camera)
- Event handlers that can't be server actions

```typescript
// ✓ Server component — default
export default async function BookingsPage() {
  const supabase = createClient()
  const { data } = await supabase.from('booking').select('...')
  return <BookingList bookings={data} />
}

// ✓ Client component — only when necessary
'use client'
export function AddressAutocomplete({ onSelect }: Props) {
  const [query, setQuery] = useState('')
  // ...
}
```

### Route groups
```
app/
  (public)/     ← resident-facing pages
  (admin)/      ← client-admin, client-staff, contractor roles
  (field)/      ← field + ranger roles (mobile PWA)
```

Each group has its own `layout.tsx` with appropriate auth + role guards.

---

## 10. Proxy (was Middleware)

`src/proxy.ts` (renamed from `middleware.ts` for Next.js 16) runs on every request. Exported function is `proxy`, not `middleware`. It does three things in order:

1. **Resolve client from hostname** — looks up `client` table by `slug` or `custom_domain`. In development (`NODE_ENV=development` + localhost), bypasses slug matching and fetches the first active client ordered by `created_at`.
2. **Validate session** — refreshes Supabase auth token if needed
3. **Route guards** — redirects unauthenticated or wrong-role users

```typescript
// Route guard rules (in order of specificity)
// /field/*   → requires role IN ('field', 'ranger')
// /admin/*   → requires role IN ('client-admin', 'client-staff', 'contractor-admin', 'contractor-staff')
// /dashboard → requires authenticated session
// /book/*    → public (guest booking allowed)
// /survey/*  → public (token-based, no auth)
```

The resolved `client_id`, `client_slug`, and `contractor_id` are set as **request** headers (`x-client-id`, `x-client-slug`, `x-contractor-id`) via `NextResponse.next({ request: { headers } })` — NOT response headers. Read via `headers()` in server components and actions. Never re-query for these in downstream code.

---

## 11. Edge Functions

All Edge Functions live in `supabase/functions/`. Each function is a single `index.ts` file.

### Conventions
```typescript
// Every Edge Function follows this structure
import { serve } from 'https://deno.land/std/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js'
import { z } from 'https://esm.sh/zod'

const InputSchema = z.object({ /* ... */ })

serve(async (req) => {
  // 1. Auth
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  // 2. Parse + validate input
  const body = await req.json()
  const parsed = InputSchema.safeParse(body)
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 })

  // 3. Create Supabase client (anon unless service role explicitly needed)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // 4. Business logic
  try {
    const result = await doWork(supabase, parsed.data)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response('Internal Server Error', { status: 500 })
  }
})
```

### Shared code
Common utilities (pricing engine, type helpers) live in `supabase/functions/_shared/`. Import with relative paths.

### Edge Functions called from public routes
Edge Functions called from `/book/*` or other public routes (e.g. `google-places-proxy`, `calculate-price`) must accept anonymous callers (anon key only, no user session). The Supabase JS client automatically sends the anon key as the Authorization header when no user is logged in. Do not require `auth.getUser()` to succeed — validate the anon key is present, not a valid user session.

### Never use service role in Edge Functions unless
- Writing to a table that legitimately requires bypassing RLS (e.g. `audit_log` inserts from triggers)
- The nightly DM-Ops sync (`nightly-sync-to-dm-ops`)
- Stripe webhook handler
- Batch admin operations (e.g. `geocode-properties`)
- Document it with a comment explaining why

---

## 12. RLS — What Claude Code Must Know

RLS is the primary security layer. Application code is defence-in-depth, not the first line of defence.

### Key helper functions (always available in DB)
```sql
current_user_role()          -- returns app_role for current user
current_user_contractor_id() -- returns contractor_id (contractor-tier roles)
current_user_client_id()     -- returns client_id (client-tier roles)
current_user_contact_id()    -- returns contact_id (resident/strata)
accessible_client_ids()      -- returns all client_ids the current user can see
is_contractor_user()         -- true for contractor-admin, contractor-staff, field
is_client_staff()            -- true for client-admin, client-staff
is_field_user()              -- true for field, ranger
has_role(app_role)           -- true if current user has that specific role
```

### When writing new queries
Always ask: "Does RLS on this table handle scoping correctly for all roles that will run this query?" If uncertain, test with a Supabase local instance using each role's JWT.

### When adding a new table
1. Enable RLS immediately: `ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;`
2. Write policies before writing any application code that queries it
3. Default to deny — no policy = no access

### Public SELECT policies
These tables have public SELECT policies (no auth required) because they are queried on public routes before any session exists: `client`, `collection_area`, `eligible_properties`, `collection_date`, `category`, `service`, `service_rules`, `allocation_rules`, `financial_year`. The policies are scoped (e.g. `is_active = true`, `is_open = true`). Write operations still require auth via separate policies.

### Never do this
```typescript
// ✗ Using service role to bypass RLS in application code
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ✗ Filtering by tenant/client in application code instead of relying on RLS
const { data } = await supabase
  .from('booking')
  .select('*')
  .eq('client_id', clientId)  // ← RLS should handle this, not the query
```

---

## 13. Capacity — Concurrency Rules

Collection date capacity is managed via:
1. DB trigger `recalculate_collection_date_units` — recalculates `*_units_booked` on every `booking_item` change
2. Postgres advisory lock in `create_booking_with_capacity_check` RPC — prevents race conditions

**Never check capacity in application code and then insert separately.** Always use the `create_booking_with_capacity_check` RPC which wraps both steps in a serialisable transaction.

```typescript
// ✓ Correct — capacity check + insert in single RPC
const { data, error } = await supabase.rpc('create_booking_with_capacity_check', {
  p_collection_date_id: collectionDateId,
  p_bucket: 'bulk',
  p_units: totalUnits,
  // ... other params
})

// ✗ Wrong — race condition window between check and insert
const { data: capacity } = await supabase
  .from('collection_date')
  .select('bulk_units_booked, bulk_capacity_limit')
  .eq('id', collectionDateId)
  .single()

if (capacity.bulk_units_booked + units <= capacity.bulk_capacity_limit) {
  // ← another request can slip in here
  await supabase.from('booking').insert({ ... })
}
```

---

## 14. Testing Requirements

### Coverage targets
- Pricing engine (`lib/pricing/calculate.ts`): **100%** — no exceptions
- State machine transitions: **100%**
- RLS policies: smoke test per role per table
- E2E booking flows: free booking, paid booking, mixed cart

### Running tests
```bash
pnpm test          # Vitest unit tests
pnpm test:e2e      # Playwright E2E
pnpm test:coverage # Coverage report
```

### Every new feature requires
1. Unit tests for any business logic function
2. E2E test for any user-facing flow
3. RLS test if a new table or policy is added

### Test file location
```
src/
  __tests__/
    pricing.test.ts
    state-machine.test.ts
tests/
  e2e/
    booking-flow.spec.ts
    auth.spec.ts
```

---

## 15. What Not To Build

These are explicitly out of scope for v2. If a task seems to require one of these, stop and check with Dan before proceeding.

| Out of scope | Why |
|---|---|
| OptimoRoute integration | Future — schema has nullable `optimo_stop_id` placeholder only |
| Stripe Connect | Future — `client_id` on payments is prep only |
| Native iOS/Android app | PWA only in v2 |
| Cross-client benchmarking in reports | Explicitly excluded — tenant data only |
| Email template management UI | Templates are code-defined in Edge Functions |
| Offline mode | Not required |
| Xero integration | Lives in DM-Ops only |
| Any DM-Ops tables | `docket`, `timesheet`, `employee`, `crew`, `asset`, `tender`, `purchase_order`, `invoice` — not in this schema |
| `dm-admin` / `dm-staff` / `dm-field` roles | These are DM-Ops roles — Verco v2 does not have them |

---

## 16. Environment Variables

```bash
# Public (safe to expose to browser)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Server only (Next.js — never expose to client)
SUPABASE_SERVICE_ROLE_KEY=       # Edge Functions only — never in app/ code
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Edge Function environment (set in Supabase dashboard)
ATTIO_API_KEY=
GOOGLE_PLACES_API_KEY=
SMS_API_KEY=
DM_OPS_SUPABASE_URL=
DM_OPS_SUPABASE_SERVICE_ROLE_KEY=
```

**If you need `SUPABASE_SERVICE_ROLE_KEY` in a file inside `app/` — stop. You are doing something wrong.**

---

## 17. Git Conventions

```bash
# Branch naming
feature/booking-wizard
fix/capacity-race-condition
chore/update-supabase-types

# Commit format (conventional commits)
feat: add MUD booking flow
fix: enforce PII suppression on ranger run sheet query
chore: regenerate supabase types after migration 042
test: add pricing engine edge cases for mixed cart

# Never commit
.env*
supabase/.temp/
```

**Never apply schema changes via the Supabase Studio SQL editor.** Always use `pnpm supabase migration new <name>` then `pnpm supabase db push`. Studio bypasses git and creates drift that requires recovery from `supabase_migrations.schema_migrations`. If drift is found, recover the SQL via `SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN (...)` and reconstruct local migration files at the matching timestamps before pushing new ones.

---

## 18. Commands Reference

```bash
# Development
pnpm dev                          # Start Next.js dev server

# Types (project ID: tfddjmplcizfirxqhotv)
pnpm supabase gen types typescript \
  --project-id tfddjmplcizfirxqhotv \
  > src/lib/supabase/types.ts
# IMPORTANT: Check the output for CLI warnings appended to the file — remove them

# Migrations
pnpm supabase migration new <name>   # Create new migration file
pnpm supabase db push                # Push migrations to remote

# Edge Functions
pnpm supabase functions deploy <name> --no-verify-jwt

# Testing
pnpm test
pnpm test:coverage
pnpm test:e2e

# Build
pnpm build
pnpm start
```

---

## 19. Key Documents

| Document | Location | Read when |
|---|---|---|
| PRD | `docs/VERCO_V2_PRD.md` | Unclear on scope, user flows, or business rules |
| TECH_SPEC | `docs/VERCO_V2_TECH_SPEC.md` | Unclear on schema, RLS, Edge Function contracts |
| CLAUDE.md | `CLAUDE.md` (this file) | Start of every session (automatic) |
| Supabase types | `lib/supabase/types.ts` | Always — generated, never hand-edit |

---

## 20. Red Lines

These are absolute. If a task requires crossing one, stop and flag it.

1. **Never set `unit_price_cents` from client input** — server-side calculation only, always re-validated on booking creation
2. **Never return `contacts.full_name`, `contacts.email`, or `contacts.mobile_e164` to `field` or `ranger` roles** — structural exclusion, not a UI hide
3. **Never use service role key in `app/` code** — Edge Functions only
4. **Never skip the advisory lock on capacity-critical writes** — always use `create_booking_with_capacity_check` RPC
5. **Never directly set `booking.status = 'Scheduled'`** — the cron owns this transition
6. **Never write to DM-Ops tables from Verco application code** — only `nightly-sync-to-dm-ops` Edge Function touches DM-Ops
7. **Never bypass RLS with application-level filtering as a substitute** — RLS is the contract, not a fallback

---

## 21. Patterns & Gotchas

### Suspense boundaries for useSearchParams
Any client component using `useSearchParams()` must be wrapped in `<Suspense>`. Split into `page.tsx` (server, renders `<Suspense><ClientForm /></Suspense>`) + `client-form.tsx` (client, uses hooks). This applies to all booking wizard steps, auth verify, and any page reading URL params.

### Postgres numeric → JavaScript number
Supabase returns `numeric` columns (latitude, longitude) as strings. Always coerce with `Number()` before passing to components that expect numbers (e.g. Leaflet maps): `lat={Number(property.latitude)}`.

### Tailwind CSS 4 font configuration
Fonts are configured in `@theme inline` block in `globals.css`, not `tailwind.config.ts` (which doesn't exist). Custom font families: `--font-sans` (DM Sans, body), `--font-heading` (Poppins, headings), applied via `font-[family-name:var(--font-heading)]`.

### Booking wizard layout
`app/(public)/book/layout.tsx` wraps all `/book/*` pages with max-width + padding via inline styles (Tailwind classes were not rendering reliably). Individual step forms use `flex flex-col` only — no `min-h-screen` or `bg-*` (layout handles those).

### Mobile number validation
AU mobiles only. `normaliseAuMobile()` in `lib/booking/schemas.ts` handles `04XX`, `+614XX`, `614XX` → E.164 `+614XXXXXXXX`. The zod schema `.transform()` pipeline strips whitespace, validates, and normalises in one pass.

### Edge Function tsconfig exclusion
`supabase/functions/` is excluded from `tsconfig.json` — Deno Edge Functions use URL imports and `Deno.*` APIs that conflict with the Node/Next.js TypeScript config.

### Pure helper libs in `src/lib/<domain>/`
Decision logic separate from data fetching. Functions take pre-fetched data as arguments — no DB calls, no Supabase imports. Tested via Vitest in `src/__tests__/<domain>-*.test.ts`. Existing examples: `lib/pricing/calculate.ts`, `lib/booking/state-machine.ts`, `lib/mud/{state-machine,address-strip,allowance,capacity,mud-lookup,validation}.ts`. Caller handles the DB query, helper decides.

### Server-side gate helper pattern
When a transition requires a precondition that applies to multiple actions, extract `assertX(id): Promise<Result<void>>` and call it at the top of every action. Example: `assertMudActualServicesSet(bookingId)` is called by `completeBooking`, `raiseNcn`, and `raiseNothingPresented` for MUD bookings. Keeps the gate logic in one place and prevents accidental gaps when new transitions are added.

### `router.refresh()` vs `router.push()`
After a server action that mutates data the parent server component is reading, use `router.refresh()` (re-fetches + re-renders the same route). Reserve `router.push(newRoute)` for actual navigation. Used in `mud-edit-form`, `mark-registered-button`, `mud-allocation-form`.

### Two-state form pattern (read-only ↔ edit)
For entity edit pages, toggle between read-only display and an inline edit form via local `isEditing` state in a single client component. Simpler than separate routes. See `src/app/(admin)/admin/properties/[id]/mud-detail-section.tsx`.

### New booking type — reuse the capacity RPC
When adding a new booking type (e.g. MUD), prefer reusing `create_booking_with_capacity_check` RPC with type-specific item defaults + immediate `update booking set type='X' where id=...` over forking the RPC. The follow-up update sits in the same server action so the inconsistency window is sub-millisecond. The RPC's collection_date capacity check applies to all types regardless. Example: MUD bookings pass `unit_price_cents=0`, `is_extra=false`, `no_services=2` placeholder per service, then update `type='MUD'`.

### `for_mud=true` collection_date gotcha
MUD bookings only see `collection_date` rows where `for_mud = true`. Easy to forget when seeding new dates — the date dropdown will silently show empty if no flagged dates exist for the area. Always set `for_mud=true` on at least one upcoming date per area when creating MUD records for testing.

---

## 22. Session Decisions — 27 March 2026

### Edge Functions built

| Function | Auth | Deploy flag | Notes |
|---|---|---|---|
| `create-booking` | Anon key (guest bookings) | `--no-verify-jwt` | Dual clients: anon for reads, service role for writes. Calls `create_booking_with_capacity_check` RPC. |
| `calculate-price` | Anon key | `--no-verify-jwt` | Refactored to import from `_shared/pricing.ts` |
| `create-checkout` | Bearer JWT (authenticated) | — | Creates Stripe Checkout Session. Caller passes `success_url` + `cancel_url`. |
| `stripe-webhook` | Stripe HMAC signature | `--no-verify-jwt` | Idempotent — checks `status` before updating. Handles `checkout.session.completed` + `charge.refunded`. |
| `process-refund` | Bearer JWT (`contractor-admin` or `client-admin`) | — | Initiates Stripe refund, updates `refund_request`. |
| `nightly-sync-to-dm-ops` | Service role (cron) | `--no-verify-jwt` | Skips areas without `dm_job_code`. Batches upserts in 500-row chunks. Writes `sync_log`. |

### Shared modules (`supabase/functions/_shared/`)

- **`pricing.ts`** — Authoritative dual-limit pricing engine. Used by both `calculate-price` and `create-booking`. Never duplicate pricing logic.
- **`cors.ts`** — CORS headers, `jsonResponse()`, `errorResponse()`, `optionsResponse()`.

### Booking ref format

`{area_code}-{6 random A-Z0-9}` — e.g. `KWN-1-A7K9M2`. Generated by `generate_booking_ref()` Postgres function with collision retry loop. Migration: `20260327100000_booking_capacity_rpc.sql`.

### Stripe separation (four functions, strict boundaries)

1. `create-booking` — **never** touches Stripe. Returns `{ requires_payment: boolean }`.
2. `create-checkout` — creates Stripe Checkout Session, inserts `booking_payment`.
3. `stripe-webhook` — confirms payment (`Pending Payment → Submitted`), processes refund events.
4. `process-refund` — initiates Stripe refund from admin UI.

### Notification deduplication

Always check `notification_log` before sending — one reminder per booking per type. `send-place-out-reminders` (cron) deduplicates via `WHERE NOT EXISTS (SELECT 1 FROM notification_log WHERE booking_id = ... AND template = 'place_out_reminder')`.

### CI/CD

`.github/workflows/ci.yml` — triggers on push to `main`/`dev` and PRs to `main`.

| Job | Runs on | Notes |
|---|---|---|
| `build` | All triggers | `pnpm build` with placeholder env vars |
| `test` | All triggers | `pnpm test` (Vitest) |
| `typecheck` | All triggers | `tsc --noEmit` |
| `types-check` | All triggers | Regenerates Supabase types, diffs against committed file, fails if stale |
| `e2e` | PRs to `main` only | Playwright, after `build` passes |

**GitHub secrets required:** `SUPABASE_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Testing gates

Manual testing plan VER-98 must pass before deployment (VER-92). PII suppression tests (TC-PII-*) are **zero tolerance** — all must pass with no exceptions.

---

## 23. Session Decisions — 27 March 2026 (afternoon)

### RLS circular recursion — SECURITY DEFINER pattern

RLS policies that cross-reference tables (e.g. `booking` → `contacts` → `booking`) cause `infinite recursion detected in policy for relation`. Fix: wrap cross-table lookups in `SECURITY DEFINER` functions.

```sql
-- ✓ Safe — SECURITY DEFINER bypasses RLS on contacts
CREATE OR REPLACE FUNCTION current_user_contact_id_by_email()
RETURNS uuid AS $$
  SELECT c.id FROM contacts c
  JOIN profiles p ON p.email = c.email
  WHERE p.id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ✗ Causes recursion when used in booking RLS
-- contact_id IN (SELECT c.id FROM contacts c JOIN profiles p ...)
```

The `booking_resident_select` policy uses both `current_user_contact_id()` (profile link) and `current_user_contact_id_by_email()` (email fallback) to handle bookings created before profile→contact linking.

### Edge Function calls — use direct fetch, not supabase.functions.invoke

`supabase.functions.invoke()` from `@supabase/ssr` browser client is unreliable. Use direct `fetch()` with explicit URL and headers:

```typescript
const res = await fetch(
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-booking`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(requestBody),
  }
)
```

### Edge Function error handling — always return the real error

Catch blocks in Edge Functions must return `err.message`, not generic strings. The RPC error path must include `rpcError.message`. Otherwise debugging is impossible.

### Profile→Contact linking after booking

After a successful booking via OTP guest flow, `confirm-form.tsx` links `profiles.contact_id` to the contact record created by the Edge Function. This is non-blocking — errors don't prevent the booking flow.

### Guest OTP verification before booking

Guest users (no session) must verify their email via OTP before a booking is submitted. The inline OTP step appears within the confirm page after form validation. On successful verification, the booking is submitted automatically. Logged-in users skip verification entirely.

### Authoritative name source — contacts.full_name

`contacts.full_name` is the authoritative name for all UI display. Never read `profiles.display_name` as the primary source. All queries that need a user's name should join `profiles → contacts(full_name)` via the `contact_id` FK.

### Turbopack root for special-character paths

`next.config.ts` sets `turbopack: { root: process.cwd() }` to fix workspace root detection when the project path contains `&` (OneDrive).

### Desktop layout conventions

- Public pages use `<main className="mx-auto w-full max-w-5xl px-6 py-8">` wrapper at the **server page level**, not inside client components
- Landing page (`/`) is full-width — manages its own sections internally
- `bg-gray-50 min-h-screen` lives on `app/(public)/layout.tsx` — client components should not set their own background
- Mobile bottom nav and FAB use `tablet:hidden` — the `tablet` breakpoint (1024px) is defined in `globals.css` as `--breakpoint-tablet: 1024px`
- Desktop nav links use `hidden tablet:flex` — visible only at 1024px and above
- Layout padding for mobile bottom nav: `app/(public)/layout.tsx` wraps `{children}` in `<div className="pb-16 tablet:pb-0">` — individual pages do not need their own bottom padding
- Desktop font sizes are +2 steps from mobile via `md:` responsive variants (e.g. `text-sm md:text-base`) — these stay at `md:`, only nav/layout switching uses `tablet:`

### Migrations applied

| Migration | Contents |
|---|---|
| `booking_capacity_rpc` | `generate_booking_ref()`, `recalculate_collection_date_units()` trigger, `create_booking_with_capacity_check()` RPC |
| `booking_resident_select_email_fallback` | Updated resident SELECT policy with email fallback |
| `fix_booking_rls_recursion` | `current_user_contact_id_by_email()` SECURITY DEFINER function, replaced inline subquery in booking policy |

---

## 24. Session Decisions — 28 March 2026

### Edge Functions built

| Function | Auth | Deploy flag | Notes |
|---|---|---|---|
| `create-ticket` | Anon key | `--no-verify-jwt` | Contact upsert by email, `TKT-{6 random}` display_id with collision retry, service role for writes |
| `create-ticket-response` | Bearer JWT (resident) | `--no-verify-jwt` | Validates ticket ownership via contact_id, rejects replies to closed/resolved tickets, auto-reopens `waiting_on_customer` → `open` |

### Service ticket display_id format

`TKT-{6 random A-Z0-9}` — e.g. `TKT-SV45RV`. Generated in the `create-ticket` Edge Function with collision retry loop (max 5 attempts). Stored in `service_ticket.display_id` (unique).

### contacts.mobile_e164 is nullable

`contacts.mobile_e164` was changed from `NOT NULL` to nullable. Service tickets can be submitted without a mobile number. Booking creation still validates mobile via zod schema before insert. Migration: `20260328083511_contacts_mobile_nullable.sql`.

### audit_log column mapping

The `audit_log` table uses: `table_name` (text), `record_id` (uuid), `action` (text), `old_data` (jsonb), `new_data` (jsonb), `changed_by` (uuid), `client_id` (uuid). Do NOT use `entity_type`, `entity_id`, or `details` — these columns do not exist.

### Admin page pattern

Admin list pages follow this pattern: `page.tsx` wraps a client component in `<Suspense>`. The client component uses `useQuery` from TanStack Query with the browser Supabase client for all data fetching, filtering, and pagination. RLS handles tenant scoping — no manual `client_id` filtering needed.

### profiles table has no app_role column

User roles live in `user_roles` table (with `user_id` FK to `profiles`, `role` column). To find staff profiles, join through `user_roles`: `supabase.from('user_roles').select('user_id, profiles!inner(id, display_name)').in('role', [...])`.

### Tailwind v4 custom breakpoints

Custom breakpoints are added via `--breakpoint-*` CSS custom properties in the `@theme inline` block in `globals.css` (not in `tailwind.config.ts`, which doesn't exist). Use `tablet:` prefix for the 1024px breakpoint for nav/layout switching. Keep `md:` for text sizing and spacing.

### Mobile navigation architecture

- **Public nav** (`components/public/public-nav.tsx`) — Sticky (`sticky top-0 z-50`), desktop-only links (`hidden tablet:flex`), no hamburger menu. Mobile shows only logo + service name.
- **Mobile bottom nav** (`components/public/mobile-bottom-nav.tsx`) — 3 tabs: Home (`/`), Bookings (`/dashboard`), Support (`/contact`). Uses `usePathname()` for active state. Lives in `app/(public)/layout.tsx`, not in individual pages.
- **Mobile FAB** (`components/public/mobile-fab.tsx`) — "+" button linking to `/book`, hidden on booking pages, hidden at `tablet:` breakpoint.

### FAQ accordion pattern

Client-configurable FAQs via `client.faq_items` (JSONB array of `{question, answer}`). Falls back to `lib/client/branding-defaults.ts` if null/empty/invalid. Validated at runtime with type narrowing before use.

### Migrations applied

| Migration | Contents |
|---|---|
| `service_ticket_rls_policies` | INSERT + UPDATE policies for service_ticket (resident + staff) |
| `contacts_mobile_nullable` | `ALTER TABLE contacts ALTER COLUMN mobile_e164 DROP NOT NULL` |
| `ticket_response_resident_insert` | INSERT policies for ticket_response (resident + staff) |
| `profiles_staff_select` | Staff can SELECT profiles with active staff-tier roles |

---

## 25. Session Decisions — 29 March 2026

### Test suite built — 117 unit + 8 E2E

| Test file | Tests | Target |
|---|---|---|
| `pricing.test.ts` | 25 | `src/lib/pricing/calculate.ts` — 100% coverage |
| `state-machine.test.ts` | 44 | `src/lib/booking/state-machine.ts` — exhaustive cross-product |
| `schemas.test.ts` | 22 | `normaliseAuMobile`, `ContactSchema`, `BookingItemSchema` |
| `search-params.test.ts` | 11 | `encodeItems`/`decodeItems` round-trips |
| `rls.test.ts` | 10 | Public table anonymous access (live Supabase) |
| `utils.test.ts` | 3 | `cn()` class merging |
| `branding-defaults.test.ts` | 2 | FAQ data structure |
| `booking-flow.spec.ts` | 3 | E2E: free, paid, mixed cart booking |
| `auth.spec.ts` | 5 | E2E: OTP form, verify page, route guards |

### Node-compatible pricing engine extraction

`src/lib/pricing/calculate.ts` is a Node-compatible copy of the pure calculation logic from `supabase/functions/_shared/pricing.ts`. Both files must be kept in sync. The Edge Function has a comment: `// Mirrored in src/lib/pricing/calculate.ts — keep in sync`. The extracted `computeLineItems()` function takes pre-fetched maps as arguments (no Supabase dependency), making it testable with Vitest and reusable for client-side price previews.

### State machine TypeScript module

`src/lib/booking/state-machine.ts` mirrors the SQL trigger `enforce_booking_state_transition()` (initial_schema.sql:704-731). Exports `canTransition(from, to)` and `getValidTargets(from)`. Use this for client-side UI checks (e.g. showing/hiding action buttons). The SQL trigger remains the enforcement layer.

### `is_contractor_user()` includes `field` — RLS PII bug found and fixed

**Critical finding:** `is_contractor_user()` returns `true` for `('contractor-admin', 'contractor-staff', 'field')`. Any RLS policy using `is_contractor_user()` to gate PII access will leak data to `field` role. This violated the zero-PII rule for field users on:
- `contacts_contractor_select` — field could read contact name, email, mobile
- `service_ticket_staff_select` / `service_ticket_staff_update` — field could read/update tickets

**Fix (migration `20260329110000`):** Replaced `is_contractor_user()` with explicit `current_user_role() IN ('contractor-admin', 'contractor-staff')` in all three policies.

**Rule going forward:** Never use `is_contractor_user()` in RLS policies that gate PII or admin-only data. Use explicit role checks excluding `field`.

### E2E testing with network-level mocking

Playwright E2E tests use `page.route()` to intercept Supabase REST and Edge Function calls at the browser level. Key patterns:
- Supabase `.single()` calls send `Accept: application/vnd.pgrst.object+json` — mocks must return matching content type
- Nested joins (e.g. `service_rules` with `service!inner(...)`) need the full nested object shape in mock responses
- Server actions (`'use server'`) and proxy calls cannot be intercepted by `page.route()` — they run server-side
- For auth-dependent post-redirect assertions, verify the API payload was correct rather than the final URL (proxy validates session server-side)

### GoTrue "Database error querying schema" limitation

GoTrue password sign-in and `admin.generateLink()` fail with `Database error querying schema` when RLS policies on `profiles` create recursive query paths (e.g. `profiles_staff_select` → `is_contractor_user()` → `current_user_role()` → `user_roles`). This is a known Supabase platform limitation. RLS role-scoped testing was verified via SQL using `SET LOCAL role TO 'authenticated'` + `SET LOCAL request.jwt.claims` through the `execute_sql` MCP tool.

### Migrations applied

| Migration | Contents |
|---|---|
| `fix_pii_field_role_exclusion` | Replaced `is_contractor_user()` with explicit `('contractor-admin', 'contractor-staff')` in contacts + service_ticket RLS policies |

---

## 26. Session Decisions — 30 March 2026

### Admin pages built (6 new list pages)

| Page | Route | Table | Key features |
|---|---|---|---|
| Non-Conformance | `/admin/non-conformance` | `non_conformance_notice` | Status/reason filters, booking link, photo count |
| Nothing Presented | `/admin/nothing-presented` | `nothing_presented` | Status/fault type filters, D&M vs Resident badge |
| Refunds | `/admin/refunds` | `refund_request` | Approve/reject actions, Stripe ref, amount display |
| Reports | `/admin/reports` | Multiple | Summary cards, bookings by status, refund totals, area filter |
| Users | `/admin/users` | `user_roles` + `profiles` | Add/edit user dialog, role/active filters, revoke access |
| Bug Reports | `/admin/bug-reports` | `bug_report` | Category/priority/status filters, assign/triage/resolve actions |

### Edge Functions built

| Function | Auth | Deploy flag | Notes |
|---|---|---|---|
| `create-user` | Bearer JWT (contractor-admin, client-admin) | `--no-verify-jwt` | Dual clients: caller JWT for permission check, service role for auth.admin + writes. Upserts contact, profile, and user_role. Sends confirmation email via SendGrid. |

### Shared modules (`supabase/functions/_shared/`)

- **`sendgrid.ts`** — SendGrid v3 Mail Send helper. `sendEmail({ to, from, subject, htmlBody })`. Requires `SENDGRID_API_KEY` secret. Returns `{ ok, error? }`. Non-blocking in callers — log warning if fails, don't block the main operation. Reusable for future `send-place-out-reminders`, `send-email`, etc.

### Email infrastructure — SendGrid + Twilio

- **Email:** SendGrid v3 Mail Send API (`https://api.sendgrid.com/v3/mail/send`), Bearer token auth. Secret: `SENDGRID_API_KEY`.
- **SMS:** Twilio (configured in `supabase/config.toml`, not yet implemented in Edge Functions). Secret: `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`.
- **Not ClickSend** — previously considered but replaced.

### User management — create-user Edge Function pattern

Admin user creation requires `auth.admin.createUser()` which needs the service role key. Since service role is forbidden in `app/` code, the flow is:
1. Frontend dialog calls `create-user` Edge Function with caller's JWT
2. Edge Function validates caller is `contractor-admin` or `client-admin` via `current_user_role()` RPC on a caller-scoped client
3. Scope check: `client-admin` can only create client-tier roles for their own client
4. Service role client handles: auth user creation, contact upsert, profile upsert, user_role upsert
5. Confirmation email sent non-blocking via SendGrid

If user already exists (duplicate email), the function finds the existing auth user via `profiles` table and updates their role. One-to-one `user_roles.user_id` constraint means each user has one role — the function updates rather than inserting a second.

### Role display labels

| DB value | Display label |
|---|---|
| `field` | Contractor Field |
| `ranger` | Client Ranger |
| All others | e.g. "Contractor Admin", "Client Staff" — prefix matches tier |

### Privacy rule — resident/strata excluded from admin users page

The admin users page filters out `resident` and `strata` roles from both the table query and the role filter/add-user dropdowns. These roles are self-service only — admin users should not see the full resident list. Enforced at query level: `.not('role', 'in', '("resident","strata")')`.

### RLS policies — user management

| Policy | Table | Type | Scope |
|---|---|---|---|
| `user_roles_staff_select` | `user_roles` | SELECT | Contractor admins see roles for their contractor + clients; client admins see their client's roles |
| `user_roles_admin_update` | `user_roles` | UPDATE | Same scope as above, but only `contractor-admin` and `client-admin` (not staff) |
| `contacts_staff_select_via_profiles` | `contacts` | SELECT | Admins can read contacts linked to profiles they can see (supplements booking-based policies) |
| Updated `profiles_staff_select` | `profiles` | SELECT | Broadened to include ALL profiles with active roles in scope (not just staff-tier) |

**Key finding:** The original `contacts` RLS policies only allowed reading contacts that had a **booking** linked to them. Users created via admin (with no bookings) were invisible. The `contacts_staff_select_via_profiles` policy fixes this by allowing contact reads via `profiles.contact_id → user_roles` join.

### Supabase FK hint pattern for multi-FK tables

When a table has multiple FKs to the same table (e.g. `bug_report` has both `reporter_id` and `assigned_to` pointing to `profiles`), Supabase requires explicit FK hints in the select:

```typescript
// ✗ Ambiguous — TypeScript error
.select('reporter:reporter_id(display_name)')

// ✓ Explicit FK hint
.select('reporter:profiles!bug_report_reporter_id_fkey(display_name)')
```

The FK name follows the pattern `{table}_{column}_fkey`. Same applies to `non_conformance_notice` and `nothing_presented` which have both `reported_by` and `resolved_by` FKs to `profiles`.

### Base UI Dialog pattern

`@base-ui/react` Dialog is used for the user form dialog. Components: `Dialog.Root` (controlled `open`/`onOpenChange`), `Dialog.Portal`, `Dialog.Backdrop`, `Dialog.Popup`, `Dialog.Title`, `Dialog.Close`. No trigger element needed when dialog is controlled externally — just use `open` state.

### Action menu overflow fix

Table action menus (three-dot dropdowns) must open **upward** (`bottom-full`) and the table wrapper must not have `overflow-hidden` or `overflow-x-auto`, otherwise the menu is clipped. Use `rounded-xl bg-white shadow-sm` without overflow classes on the table container.

### `accessible_client_ids()` returns a single value per call

The `accessible_client_ids()` function uses `SELECT ... FROM client WHERE contractor_id = ...` which can return multiple rows, but when used in RLS with `IN (SELECT accessible_client_ids())` it works correctly as a set. For contractor-tier users it returns all client IDs under their contractor; for client-tier users it returns their single client ID.

### Migrations applied

| Migration | Contents |
|---|---|
| `user_roles_admin_select_and_profiles_staff_select` | `user_roles_staff_select` SELECT policy + broadened `profiles_staff_select` for admin user management |
| `contacts_staff_select_via_profiles` | SELECT policy on contacts via profiles→user_roles join (supplements booking-based policies) |
| `user_roles_admin_update` | UPDATE policy for contractor-admin and client-admin on user_roles |

---

## 27. Session Decisions — 1 April 2026

### NCN/NP workflow — Issued + Dispute + Auto-close

Field records NCN/NP → status defaults to `Issued` (not `Open`). Resident can click "Dispute" on the booking detail card within 14 days → status changes to `Disputed`. Staff can only investigate/resolve/rebook `Disputed` or `Under Review` notices. Undisputed notices auto-close after 14 days via `auto-close-notices` Edge Function (cron).

**Status flow:** `Issued → Disputed → Under Review → Resolved / Rescheduled (NCN) / Rebooked (NP)`
**Auto-close:** `Issued → Closed` (14 days, no dispute)

The `Open` enum value is kept but unused — removing Postgres enum values is destructive.

### `contractor_fault` — unified naming

Both `non_conformance_notice` and `nothing_presented` use `contractor_fault` (boolean). The NP table's original `dm_fault` column was renamed in migration `20260401120000`. When `contractor_fault = true`:
- Original booking items excluded from allocation counting (future: modify pricing queries)
- If resolved without rebook and booking has paid items → auto-refund via `process-refund` Edge Function
- If rebooked → paid items on the new booking are set to `unit_price_cents: 0`

### Resident dispute — RLS-enforced status transition

RLS policies `ncn_resident_update_dispute` and `np_resident_update_dispute` constrain residents to only change status from `Issued` to `Disputed` on their own bookings. Server actions call `.update({ status: 'Disputed' })` — the RLS policy enforces both ownership and valid transition.

### Admin link on public nav

Staff-tier users (`contractor-admin`, `contractor-staff`, `client-admin`, `client-staff`) see an "Admin" link in the public desktop nav and a 4th "Admin" tab in mobile bottom nav. Checked server-side in `app/(public)/layout.tsx` via `user_roles` query. Runs in parallel with branding query (`Promise.all`). Defaults to `false` on any error — never blocks rendering.

### Booking detail desktop layout

Resident booking detail (`/booking/[ref]`) uses a 2-col `md:grid-cols-2` layout:
- Row 1: Contact details (left) + Collection details (right)
- Row 2: Included services (left) + Extra services (right)
- Enquiries card at half-width (left column only)
- Action buttons in `flex-row` on desktop, `flex-col` on mobile
- Header shows formatted address from `property:property_id(formatted_address, address)` — not area/type

### Receipt URL from Stripe

`booking_payment.receipt_url` (text, nullable) stores the Stripe-hosted receipt URL. Populated in `stripe-webhook` by expanding the `latest_charge` on the PaymentIntent. Displayed as "View receipt" link in the extra services card on booking detail.

### Dashboard enquiries — show all statuses

Resident dashboard enquiries tab shows all ticket statuses (including resolved/closed), not just active ones. The stat card counts only active tickets (`open`, `in_progress`, `waiting_on_customer`).

### Cancelled booking badge — red

`BookingStatusBadge` uses `bg-[#FFF0F0] text-[#E53E3E]` for Cancelled status (was grey). Consistent with Non-conformance and Missed Collection.

### Place-out/countdown — active bookings only

The place-out reminder and countdown/cancellation warning on dashboard booking cards are gated behind `UPCOMING_STATUSES` (Submitted, Confirmed, Scheduled). They don't show on cancelled or completed cards.

### Rebook button for terminal statuses

Booking detail shows a green "Rebook" button for terminal statuses (Completed, Cancelled, Non-conformance, Nothing Presented, Rebooked, Missed Collection). Links to `/book?address={formatted_address}` — the address form auto-resolves from the `?address=` param.

### Edge Functions built

| Function | Auth | Deploy flag | Notes |
|---|---|---|---|
| `auto-close-notices` | Service role (cron) | `--no-verify-jwt` | Closes NCN/NP in `Issued` status older than 14 days. Schedule: `0 2 * * *` (10:00 AWST). |

### Admin pages built — NCN + NP detail

| Page | Route | Key features |
|---|---|---|
| NCN Detail | `/admin/non-conformance/[id]` | Info cards (2-col), photos with lightbox, resolution form (contractor_fault checkbox, notes), rebook dialog (date picker), refund confirmation dialog |
| NP Detail | `/admin/nothing-presented/[id]` | Same pattern as NCN. Fault type = contractor_fault (renamed from dm_fault) |

Both use the same patterns: `verifyStaffRole()` helper, `Result<T>` return type, Base UI Dialog for rebook/refund confirmation. Resolution actions only available for `Disputed` + `Under Review` statuses. `Issued` shows "Awaiting resident response" message.

### Multi-FK hint syntax reminder

`non_conformance_notice` and `nothing_presented` both have two FKs to `booking` (`booking_id` and `rescheduled_booking_id`). Supabase select must use FK hints: `booking:booking!non_conformance_notice_booking_id_fkey(...)`. Same pattern as `bug_report` (§26).

### Migrations applied

| Migration | Contents |
|---|---|
| `booking_payment_receipt_url` | `receipt_url` text column on `booking_payment` |
| `booking_payment_resident_select` | Resident + staff SELECT policies on `booking_payment` |
| `ncn_contractor_fault` | `contractor_fault` boolean on NCN + staff UPDATE RLS policy |
| `np_staff_update` | Rename `dm_fault` → `contractor_fault` on NP + staff UPDATE RLS policy |
| `ncn_np_issued_disputed_closed` | Add `Issued`/`Disputed`/`Closed` to both enums, change defaults, migrate Open → Issued, resident dispute RLS policies |

### Pending post-deployment steps

1. `pnpm supabase db push` — apply all 5 migrations
2. `pnpm supabase functions deploy stripe-webhook --no-verify-jwt`
3. `pnpm supabase functions deploy auto-close-notices --no-verify-jwt`
4. Schedule `auto-close-notices` cron via `pg_cron` (see Edge Function file for SQL)
5. Regen types: `pnpm supabase gen types typescript --project-id tfddjmplcizfirxqhotv > src/lib/supabase/types.ts`
6. Clean up `as never` / `as unknown` casts and `contractor_fault: false` defaults after type regen
7. Replace remaining `dm_fault` references in NP list page with `contractor_fault` after type regen

### Admin dashboard audit — Priority 1 remaining

| # | Gap | Status |
|---|---|---|
| 1 | NCN detail + actions | **Done** |
| 2 | NP detail + actions | **Done** |
| 3 | Refund → Stripe wiring | Pending — connect admin refund approve button to `process-refund` Edge Function |
| 4 | Bulk booking actions | Pending — confirm/cancel from list view (checkbox + action bar) |
| 5 | Allocation override table | Separate feature — for new owner reinstatement, council credits |

---

## 28. Session Decisions — 8 April 2026 — MUD Module

Built MUD onboarding-to-booking-to-crew loop end-to-end on `feature/mud-module`. Phases A + B + C done, D mostly done, D2 (NCN dual-recipient email) deferred to the field operator interface work, E pending. Full architectural design lives in `~/obsidian/Claude/wiki/projects/wmrc-verco-v2-rollout/{mud-module-brief.md, mud-module-tech-plan.md}`.

### MUD admin booking — single page, not wizard reuse

Originally the tech plan suggested branching the resident `/book/*` wizard with `?mud=` query params at every step. **Decision reversed in-session:** MUDs only need date + service inputs (contact + location pre-filled from the MUD record), so a dedicated single-page form at `/admin/properties/[id]/book` is dramatically simpler and zero risk to SUD flows. The `?on_behalf=true` param on the public wizard is still used for SUD admin bookings — MUDs don't touch it.

### Eat-our-own-dog-food seed approach

Brief specified seeding 3 test MUDs into a dev environment via a migration. Reality: there's no separate dev environment (`tfddjmplcizfirxqhotv` is also dev). Decision: defer A2 to B1's acceptance test. The very first MUD record (KWN-1-MUD-01 = 18 Sulphur Rd Wellard, 20 units, Quarterly cadence) was created via the new modal as B1's smoke test, validating both the schema constraints and the create form in one pass. Pattern reusable for any future "seed dev data" task in this single-environment setup.

### Schema migration drift recovery

Discovered 6 migrations existed in `supabase_migrations.schema_migrations` (live DB) that had been applied via the Supabase Studio SQL editor and never committed to git. Symptom: `pnpm supabase db push` refused to apply new migrations. Recovery: queried the migration history table via Studio (`SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN (...)`), reconstructed local files at the matching timestamps with provenance comments, then push reconciled cleanly. Lesson now in §17: never use the Studio SQL editor for schema changes.

**Known issue logged for later cleanup:** `20260402141720_allocation_override_service_level.sql` is timestamped before `20260402150000_allocation_override.sql`, but the former ALTERs a table the latter creates. Live applied them in author order; a fresh `supabase db reset` would fail. Rename one to fix the chronology before any reset.

### MUD field crew gating — multi-item, no auto-complete

Per brief Q2: `actual_services` is required on Completed, Non-conformance, AND Nothing Presented for MUD bookings (was: only Completed). Implementation: `assertMudActualServicesSet(bookingId)` server helper called by all three transition actions. The `MudAllocationForm` was rewritten to render one counter per booking_item (was: first item only — pre-existing scaffolding limitation) and the save action no longer auto-transitions to Completed. After save, `BookingCloseoutClient`'s early-return into the form falls through and the standard close-out actions render with all three transitions enabled.

### Public booking MUD redirect — fallback strip-prefix lookup

`address-form.tsx` now does the property lookup twice: first with the raw input, then on miss with `stripAddressPrefix()` applied (catches "Unit 5 / 18 Sulphur Rd"). If either resolves to a property with `is_mud=true`, the booking flow is blocked with a purple "Multi-unit property" notice pointing to `client.contact_email`. Pattern uses the pure helpers `lib/mud/address-strip.ts` and `lib/mud/mud-lookup.ts`.

### Phase D2 deferred

NCN dual-recipient email pipeline (greenfield — no email pipeline currently exists for NCN notifications) deferred to the broader field operator interface work. Rationale: this would be the first email pipeline in the codebase and the design will set precedent for all future notifications (place-out reminders, refund confirmations, etc) — better to design once with more requirements visible than to bind it to MUDs prematurely. Wireup point when it lands: `raiseNcn()` in `src/app/(field)/field/booking/[ref]/actions.ts`.

### Pre-existing tech debt fixed (unmasked by type regen)

- `nothing-presented-client.tsx`: `dm_fault` → `contractor_fault` (CLAUDE.md §26 follow-up was pending)
- `address-form.tsx`: nullable `collection_area_id` guards added
- Both were blocking the A1 typecheck gate after `pnpm supabase gen types typescript` regenerated from the live schema

### Branch state at end of session

`feature/mud-module` pushed to origin with 7 feature commits (`80801a6` → `81189a7`). Working tree clean. 183/183 tests green, build clean. PR creation link: `https://github.com/daniel-dmwaste/verco/pull/new/feature/mud-module`. Smoke test scheduled for 09/04/2026 morning via PA dispatch.

---

*Keep this file current. If a decision changes in the PRD or TECH_SPEC, update CLAUDE.md in the same PR.*
