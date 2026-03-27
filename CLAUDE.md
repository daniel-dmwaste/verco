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

The authoritative implementation is in `supabase/functions/calculate-price/index.ts`. The client-side preview in `services-form.tsx` mirrors the same logic for display purposes only.

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
Non-conformance → Rescheduled     (client-admin, contractor-*)
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
- Mobile bottom nav uses `md:hidden` — never visible on desktop
- Desktop font sizes are +2 steps from mobile via `md:` responsive variants (e.g. `text-sm md:text-base`)

### Migrations applied

| Migration | Contents |
|---|---|
| `booking_capacity_rpc` | `generate_booking_ref()`, `recalculate_collection_date_units()` trigger, `create_booking_with_capacity_check()` RPC |
| `booking_resident_select_email_fallback` | Updated resident SELECT policy with email fallback |
| `fix_booking_rls_recursion` | `current_user_contact_id_by_email()` SECURITY DEFINER function, replaced inline subquery in booking policy |

---

*Keep this file current. If a decision changes in the PRD or TECH_SPEC, update CLAUDE.md in the same PR.*
