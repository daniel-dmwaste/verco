# CLAUDE.md — Verco v2

Read at the start of every session. Keep current; if a decision changes, update this file in the same PR. Session-by-session decision context lives in `~/.claude/memory/verco/session-log.md`. Inventories (Edge Functions, migrations, admin pages) are derivable from the filesystem — do not list them here.

---

## 1. What This Project Is

**Verco** is a white-labelled, multi-tenant SaaS platform for managing residential bulk verge collection bookings on behalf of WA local governments.

- **Operator:** D&M Waste Management (Safety Bay WA)
- **Companion app:** DM-Ops (separate repo, separate Supabase project)
- **Full spec:** `docs/VERCO_V2_PRD.md` and `docs/VERCO_V2_TECH_SPEC.md`

---

## 2. Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server components, server actions, proxy |
| Language | TypeScript 5 strict | `strict: true` — no exceptions |
| Styling | Tailwind CSS 4 | `@theme inline` block in `globals.css` (no `tailwind.config.ts`) |
| UI | shadcn/ui (Radix primitives) + `@base-ui/react` Dialog | `components/ui/` — never edit |
| Forms | react-hook-form + zod | All forms via zod schemas |
| Server state | TanStack Query v5 | All async data fetching |
| Backend | Supabase (project `tfddjmplcizfirxqhotv`, ap-southeast-2) | Anon key + RLS, never service role in app code |
| Auth | Supabase Auth — email OTP only | No passwords, no OAuth |
| Payments | Stripe | Single D&M account |
| Package manager | pnpm | Never npm or yarn |
| Testing | Vitest + Testing Library + Playwright | Unit at `src/__tests__/`, E2E at `tests/e2e/` |
| Fonts | Poppins (heading) + DM Sans (body) via next/font/google | `--font-heading`, `--font-sans` |
| Maps | Leaflet via `dynamic(() => …, { ssr: false })` | Coerce Postgres `numeric` → `Number()` |
| Hosting | Coolify on BinaryLane | Node container — no edge runtime |

---

## 3. Entity Hierarchy

Always think in this hierarchy. Every feature touches one or more of these levels:

```
Contractor          e.g. D&M Waste Management
  └── Client        e.g. City of Kwinana, WMRC (Verge Valet)
        └── Sub-client   e.g. City of Cockburn (COT) under WMRC — nullable
              └── Collection Area   e.g. KWN-1, VV-COT — atomic booking unit
                    └── Eligible Property   e.g. 23 Leda Blvd, Wellard
                          └── Booking

Category (Bulk / Ancillary / Illegal Dumping)
  └── Service (General, Green, Mattress, E-Waste, Whitegoods)
```

**Schema:** `category` (codes 'bulk', 'anc', 'id') → `service` (FK `category_id`) → `service_rules` (per area per service) | `allocation_rules` (per area per category) | `allocation_override` (per property per FY per service admin grants — both SUD + MUD bumps). `booking_item.service_id` → `service` (renamed from `service_type_id` in March). `audit_log` columns are `table_name`/`record_id`/`action`/`old_data`/`new_data`/`changed_by`/`client_id` (NOT `entity_type`/`entity_id`/`details`). `contacts.full_name` is the authoritative name for all UI display — never read `profiles.display_name` as primary. `contacts.mobile_e164` is nullable. `profiles` has NO `app_role` column — roles live in `user_roles` (one row per user via `UNIQUE (user_id)`).

**MUD scaffolding on `eligible_properties`:** `is_mud`, `unit_count`, `mud_code`, `mud_onboarding_status` enum (`Contact Made`/`Registered`/`Inactive`), `collection_cadence` enum (`Ad-hoc`/`Annual`/`Bi-annual`/`Quarterly`), `waste_location_notes`, `auth_form_url`, `strata_contact_id` → contacts. View `v_mud_next_expected` for Registered MUD reminders. Storage bucket `mud-auth-forms` (private, 10 MB, PDF/JPG/PNG/HEIC). CHECK constraints enforce 8-unit threshold and Registered prereqs.

**Key rules:** Resident portal is branded at the **client** level (`kwn.verco.au`). Address lookup resolves to a **collection area** — never ask the resident to pick one. Sub-clients are optional (KWN has none, WMRC has nine). `dm_job_code` on `collection_area` is metadata for DM-Ops sync — never business logic.

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
| `strata` | End user | Authorised MUD properties only (dormant — v2) |

**PII rule — absolute, no exceptions:** `field` and `ranger` roles receive **zero** contact information. Never query `contacts.full_name`, `contacts.email`, or `contacts.mobile_e164` in any code path accessible to these roles. Defence in depth: enforced at RLS level AND in query structure.

---

## 5. Supabase Client Usage

Two clients in the app, one in Edge Functions. Pick the right one:

| Context | Use |
|---|---|
| `app/**/page.tsx`, `layout.tsx`, `app/api/**`, server actions | `lib/supabase/server.ts` (`createClient()`, awaits cookies) |
| `'use client'` files, hooks | `lib/supabase/client.ts` (`createBrowserClient`) |
| Edge Functions | `createClient()` with `SUPABASE_ANON_KEY` + `Authorization` header |

**Rules:**
- **Always use the anon key** in app code — RLS does the access control
- **Never use the service role key** in any client-side or server component code. Service role only in Edge Functions where bypassing RLS is explicitly required (with a comment explaining why).
- Never import `SUPABASE_SERVICE_ROLE_KEY` into any file under `app/` — must stay in `supabase/functions/`
- `supabase.functions.invoke()` from the browser client is unreliable. Use direct `fetch()` with explicit URL + Bearer header.

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
2. Edge Function returns `PriceCalculationResult` — client displays this
3. On confirm, client calls `create-booking` Edge Function
4. `create-booking` **re-runs** `calculatePrice` internally — never trusts the displayed price
5. If recalculated price differs, the booking is rejected

`create-booking` **never touches Stripe.** It returns `{ requires_payment }`. Stripe lives in `create-checkout`, `stripe-webhook`, `process-refund`.

**Dual-limit free unit calculation:** a unit becomes paid (extra) when EITHER limit is exhausted. `free_units = MIN(requested_qty, category_remaining, service_remaining)` where `category_remaining = allocation_rules.max - FY usage across ALL services in that category` and `service_remaining = service_rules.max - FY usage for THIS service`. Only `free_units` consume category budget — paid units do not reduce remaining. When iterating multiple services in the same category, track cumulative free unit consumption with a `categoryFormUsed` map.

Authoritative impl: `supabase/functions/_shared/pricing.ts`. Node-compatible extraction at `src/lib/pricing/calculate.ts` (Vitest-tested, **keep in sync**). Client-side preview in `services-form.tsx` mirrors for display only.

---

## 7. Booking State Machine — Hard Rules

DB trigger `enforce_booking_state_transition` rejects invalid transitions. Don't try to force one from app code either.

```
Pending Payment  → Submitted          (Stripe webhook only)
Pending Payment  → Cancelled          (system: payment expired)
Submitted        → Confirmed          (client-admin, client-staff, contractor-*)
Submitted        → Cancelled          (any staff role or resident pre-cutoff)
Confirmed        → Scheduled          (cron 3:25pm AWST daily — never manual)
Confirmed        → Cancelled          (any staff role pre-cutoff)
Scheduled        → Completed          (field role only)
Scheduled        → Non-conformance    (field role only)
Scheduled        → Nothing Presented  (field role only)
Scheduled        → Cancelled          (any staff role pre-cutoff)
Non-conformance  → Rebooked           (client-admin, contractor-*)
Nothing Presented → Rebooked          (client-admin, contractor-*)
```

**Never directly set `status = 'Scheduled'`** from app code — the cron owns it.

**Cancellation cutoff:** 3:30pm AWST the day prior. DB trigger `enforce_cancellation_cutoff` rejects violations. Always check `can_cancel_booking()` RPC before showing the cancel UI.

**NCN/NP statuses:** field records as `Issued` (default). Resident clicks "Dispute" within 14 days → `Disputed`. Staff investigate Disputed/Under Review → `Resolved` / `Rescheduled` / `Rebooked`. Undisputed `Issued` notices auto-close after 14 days via `auto-close-notices` cron. The `Open` enum value is kept but unused — removing Postgres enum values is destructive.

---

## 8. TypeScript Conventions

- **`strict: true`** + `noUncheckedIndexedAccess` + `noImplicitReturns`
- **Never use `any`** — always use generated types: `Database['public']['Tables']['booking']['Row']`
- **Regenerate types after every migration:** `pnpm supabase gen types typescript --project-id tfddjmplcizfirxqhotv > src/lib/supabase/types.ts` — and remove any CLI warnings the command appends
- **Zod schemas for all external inputs** — every API route, server action, and Edge Function input is validated
- **Result pattern for errors** — `type Result<T, E = string> = { ok: true; data: T } | { ok: false; error: E }`. Never throw across async boundaries.
- **Mobile validation** — AU only. `normaliseAuMobile()` in `lib/booking/schemas.ts` handles `04XX`, `+614XX`, `614XX` → E.164.

---

## 9. File & Folder Conventions

- **Files** `kebab-case.tsx`, **components** `PascalCase`, **hooks** `useCamelCase`, **server actions** `camelCase` in `actions.ts`
- **Co-location**: sibling files at the route level (e.g. `properties-client.tsx` next to `page.tsx`). Promote to `components/` only when used in 3+ places. **Do NOT use `_components/` subfolders** — that pattern is not used in this repo.
- **Default to server components.** Add `'use client'` only for `useState`/`useEffect`/browser APIs/event handlers that can't be server actions.
- **Route groups:** `(public)/` resident-facing, `(admin)/` admin/staff, `(field)/` field+ranger. Each has its own `layout.tsx` with auth + role guards.
- **Tests** at `src/__tests__/<area>.test.ts` (flat — no co-located `__tests__/` folders). E2E at `tests/e2e/`.

---

## 10. Proxy (was Middleware)

`src/proxy.ts` (renamed from `middleware.ts` for Next.js 16). Exported function is `proxy`, not `middleware`. Runs on every request, three things in order:

1. **Resolve client from hostname** — looks up `client` table by `slug` or `custom_domain`. In dev (`NODE_ENV=development` + localhost), bypasses slug matching and fetches the first active client.
2. **Validate session** — refreshes Supabase auth token if needed
3. **Route guards** — `/field/*` requires `field`/`ranger`; `/admin/*` requires staff-tier; `/dashboard` requires authenticated; `/book/*` and `/survey/*` are public

Resolved `client_id`, `client_slug`, `contractor_id` are set as **request** headers (`x-client-id`, etc.) via `NextResponse.next({ request: { headers } })` — NOT response headers. Read via `headers()` in server components and actions. Never re-query for these in downstream code.

---

## 11. Edge Functions

All in `supabase/functions/`, each a single `index.ts`. Structure: parse JSON → zod validate → supabase client → logic → JSON response. **Always return real `err.message` from catch blocks** — generic strings make debugging impossible.

**Anon vs service role:** default to anon key + caller's `Authorization` header (RLS does access control). Service role only with a documented reason — currently: `audit_log` trigger inserts, `nightly-sync-to-dm-ops`, `stripe-webhook`, `create-user` (needs `auth.admin.createUser`), `geocode-properties` (batch admin).

**Public-route Edge Functions** (`/book/*` callers like `google-places-proxy`, `calculate-price`): validate the anon key is present, do NOT require `auth.getUser()` to succeed.

**Admin-write Edge Functions pattern** (e.g. `create-user`): caller-scoped client validates the JWT role + scope first, then a separate service-role client does the writes.

**Shared modules** in `_shared/`: `pricing.ts` (authoritative engine — never duplicate), `cors.ts` (`jsonResponse`/`errorResponse`/`optionsResponse`), `sendgrid.ts` (single recipient — fan out for multi-recipient).

`supabase/functions/` is excluded from `tsconfig.json` — Deno URL imports conflict with Next.js TS config.

---

## 12. RLS — What Claude Code Must Know

RLS is the primary security layer. App code is defence-in-depth, not the first line.

**Helper functions (always available):** `current_user_role()`, `current_user_contractor_id()`, `current_user_client_id()`, `current_user_contact_id()`, `current_user_contact_id_by_email()`, `accessible_client_ids()`, `is_contractor_user()`, `is_client_staff()`, `is_field_user()`, `has_role(app_role)`.

**`is_contractor_user()` includes `field`** — using it in any RLS policy that gates PII or admin-only data leaks to the field role. Always use explicit `current_user_role() IN ('contractor-admin', 'contractor-staff')` instead. (Real bug, fixed in migration `20260329110000`.)

**`accessible_client_ids()` does NOT honour `sub_client_id`** today. Returns all clients under the contractor for contractor-tier; just `current_user_client_id()` for client-tier. Sub-client scoping is v2.

**RLS circular recursion** — when policies cross-reference tables (e.g. `booking` → `contacts` → `booking`) you get `infinite recursion detected in policy for relation`. Wrap cross-table lookups in `SECURITY DEFINER` functions like `current_user_contact_id_by_email()`.

**Public SELECT policies** exist on tables queried before any session: `client`, `collection_area`, `eligible_properties`, `collection_date`, `category`, `service`, `service_rules`, `allocation_rules`, `financial_year`. Always scoped (`is_active = true`, etc). Writes still require auth.

**Adding a new table:** enable RLS immediately, write policies before any app code queries it, default to deny.

**Never use service role to bypass RLS in app code, and never filter by tenant/client in app code as a substitute for RLS.** RLS is the contract.

---

## 13. Capacity — Concurrency Rules

Collection date capacity is managed via:
1. DB trigger `recalculate_collection_date_units` — recalculates `*_units_booked` on every `booking_item` change
2. Postgres advisory lock in `create_booking_with_capacity_check` RPC — prevents race conditions

**Never check capacity in app code and then insert separately.** Always use `create_booking_with_capacity_check` — wraps both steps in a serialisable transaction.

```typescript
// ✓ Correct
const { data, error } = await supabase.rpc('create_booking_with_capacity_check', {
  p_collection_date_id, p_property_id, p_contact_id, p_collection_area_id,
  p_client_id, p_contractor_id, p_fy_id, p_area_code,
  p_location, p_notes, p_status, p_items
})
```

**New booking type — reuse the RPC.** When adding a new booking type (e.g. MUD), pass type-specific item defaults to the same RPC + `update booking set type='X' where id=...` immediately after. The follow-up update sits in the same server action so the inconsistency window is sub-millisecond. The RPC's collection_date capacity check applies to all types.

---

## 14. Testing Requirements

**Coverage targets:**
- Pricing engine (`lib/pricing/calculate.ts`): **100%** — no exceptions
- State machine transitions: **100%**
- RLS policies: smoke test per role per table
- E2E booking flows: free, paid, mixed cart

**Commands:** `pnpm test` (Vitest), `pnpm test:e2e` (Playwright), `pnpm test:coverage`. Tests live at `src/__tests__/<area>.test.ts` and `tests/e2e/`.

**Every new feature requires:** unit tests for any business logic function, E2E test for any user-facing flow, RLS test if a new table or policy is added.

**E2E mocking** uses `page.route()` to intercept Supabase REST + Edge Function calls. Supabase `.single()` calls send `Accept: application/vnd.pgrst.object+json` — mocks must match. Server actions and proxy calls run server-side and cannot be intercepted — verify the API payload was correct rather than the final URL.

**GoTrue limitation:** password sign-in and `admin.generateLink()` fail with `Database error querying schema` when RLS policies on `profiles` create recursive query paths. Verify role-scoped behaviour via SQL `SET LOCAL role TO 'authenticated'` + `SET LOCAL request.jwt.claims` instead.

**PII suppression tests are zero tolerance** — all must pass.

---

## 15. What Not To Build

Out of scope for v2. Stop and check before proceeding if a task seems to require one:

- **OptimoRoute integration** (future — schema has nullable `optimo_stop_id` placeholder only)
- **Stripe Connect** (future — `client_id` on payments is prep only)
- **Native iOS/Android app** (PWA only in v2)
- **Cross-client benchmarking in reports** (tenant data only)
- **Email template management UI** (templates are code-defined in Edge Functions)
- **Offline mode** (not required)
- **Xero integration** (lives in DM-Ops only)
- **Any DM-Ops tables** — `docket`, `timesheet`, `employee`, `crew`, `asset`, `tender`, `purchase_order`, `invoice`
- **`dm-admin` / `dm-staff` / `dm-field` roles** — DM-Ops only, no Verco v2 equivalents

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
SENDGRID_API_KEY=
SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=
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

# Never commit
.env*
supabase/.temp/
```

**Never apply schema changes via the Supabase Studio SQL editor.** Always use `pnpm supabase migration new <name>` then `pnpm supabase db push`. Studio bypasses git and creates drift that requires recovery from `supabase_migrations.schema_migrations`. If drift is found: `SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN (...)`, reconstruct local migration files at the matching timestamps with provenance comments, then push.

**Never push to `main` without asking.** Feature branches push freely.

---

## 18. Commands Reference

```bash
# Development
pnpm dev                          # Start Next.js dev server

# Types (project ID: tfddjmplcizfirxqhotv)
pnpm supabase gen types typescript \
  --project-id tfddjmplcizfirxqhotv \
  > src/lib/supabase/types.ts
# Check the output for CLI warnings appended to the file — remove them

# Migrations
pnpm supabase migration new <name>   # Create new migration file
pnpm supabase db push                # Push migrations to remote
pnpm supabase db push --dry-run      # Preview before pushing

# Edge Functions
pnpm supabase functions deploy <name> --no-verify-jwt

# Testing + build
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm tsc --noEmit
pnpm build
```

---

## 19. Key Documents

| Document | Location | Read when |
|---|---|---|
| PRD | `docs/VERCO_V2_PRD.md` | Unclear on scope, user flows, business rules |
| TECH_SPEC | `docs/VERCO_V2_TECH_SPEC.md` | Unclear on schema, RLS, Edge Function contracts |
| Session log | `~/.claude/memory/verco/session-log.md` | Need historical session-by-session decision context |
| Supabase types | `src/lib/supabase/types.ts` | Always — generated, never hand-edit |

---

## 20. Red Lines

These are absolute. If a task requires crossing one, stop and flag it.

1. **Never set `unit_price_cents` from client input** — server-side calculation only, always re-validated on booking creation
2. **Never return `contacts.full_name`, `contacts.email`, or `contacts.mobile_e164` to `field` or `ranger` roles** — structural exclusion, not a UI hide
3. **Never use service role key in `app/` code** — Edge Functions only
4. **Never skip the advisory lock on capacity-critical writes** — always use `create_booking_with_capacity_check`
5. **Never directly set `booking.status = 'Scheduled'`** — the cron owns this transition
6. **Never write to DM-Ops tables from Verco app code** — only `nightly-sync-to-dm-ops` touches DM-Ops
7. **Never bypass RLS with application-level filtering as a substitute** — RLS is the contract
8. **Never apply schema changes via the Supabase Studio SQL editor** — always via committed migration files

---

## 21. Patterns & Gotchas

### Suspense + useSearchParams
Any client component using `useSearchParams()` must be wrapped in `<Suspense>`. Split: `page.tsx` (server, renders `<Suspense><ClientForm /></Suspense>`) + `client-form.tsx` (client, uses hooks).

### Postgres `numeric` → JS number
Supabase returns `numeric` columns (latitude, longitude) as strings. Always coerce with `Number()` before passing to components that expect numbers (Leaflet etc).

### Tailwind v4 + layout
No `tailwind.config.ts` — fonts and breakpoints live in `@theme inline` in `globals.css`. Font families: `--font-sans` (DM Sans body), `--font-heading` (Poppins). Custom breakpoints via `--breakpoint-*` (e.g. `--breakpoint-tablet: 1024px`). Use `tablet:` prefix for nav/layout switching at 1024px; keep `md:` for text sizing and spacing.

Layout conventions: public pages wrap content with `<main className="mx-auto w-full max-w-5xl px-6 py-8">` at the **server page level**, not inside client components. `bg-gray-50 min-h-screen` lives on `app/(public)/layout.tsx`. Mobile bottom nav padding is on the layout (`pb-16 tablet:pb-0`). Landing page (`/`) is full-width. Booking wizard layout (`app/(public)/book/layout.tsx`) uses inline styles for max-width + padding (Tailwind classes weren't rendering reliably) — step forms use `flex flex-col` only, no `min-h-screen` or `bg-*`.

### Mobile navigation
- `components/public/public-nav.tsx` — sticky, desktop-only links (`hidden tablet:flex`), no hamburger
- `components/public/mobile-bottom-nav.tsx` — Home / Bookings / Support tabs, plus Admin tab for staff
- `components/public/mobile-fab.tsx` — "+" button to `/book`, hidden on booking pages + `tablet:` breakpoint
- Staff-tier check for Admin tab runs in `app/(public)/layout.tsx` via parallel `user_roles` query, defaults to false on error

### Pure helper libs in `src/lib/<domain>/`
Decision logic separate from data fetching. Functions take pre-fetched data as arguments — no DB calls, no Supabase imports. Tested via Vitest in `src/__tests__/<domain>-*.test.ts`. Examples: `lib/pricing/calculate.ts`, `lib/booking/state-machine.ts`, `lib/mud/{state-machine,address-strip,allowance,capacity,mud-lookup,validation}.ts`.

### Server-side gate helper
When a transition has a precondition that applies to multiple actions, extract `assertX(id): Promise<Result<void>>` and call at the top of every action. Keeps the gate logic in one place. Example: `assertMudActualServicesSet(bookingId)` is called by `completeBooking`, `raiseNcn`, and `raiseNothingPresented`.

### `router.refresh()` vs `router.push()`
After a server action that mutates data the parent server component reads, use `router.refresh()` (re-fetches + re-renders the same route). Reserve `router.push(newRoute)` for navigation.

### Two-state form (read-only ↔ edit) + admin list page
For entity edit pages, toggle between read-only display and an inline edit form via local `isEditing` state in one client component. Simpler than separate routes. Admin list pages: `page.tsx` wraps a client component in `<Suspense>`; client uses TanStack Query + browser Supabase client for fetching, filtering, pagination. RLS handles tenant scoping.

### Multi-FK Supabase select pattern
When a table has multiple FKs to the same target (e.g. `bug_report.reporter_id` + `assigned_to` both → `profiles`; `non_conformance_notice.booking_id` + `rescheduled_booking_id` both → `booking`), Supabase requires explicit FK hints in the select:

```typescript
.select('reporter:profiles!bug_report_reporter_id_fkey(display_name)')
```

FK name pattern: `{table}_{column}_fkey`. Without the hint you get a TypeScript error.

### Base UI Dialog pattern
`@base-ui/react` Dialog: `Dialog.Root` (controlled `open`/`onOpenChange`), `Dialog.Portal`, `Dialog.Backdrop`, `Dialog.Popup`, `Dialog.Title`, `Dialog.Close`. No trigger element needed when controlled externally.

### Action menu overflow
Table action menus must open **upward** (`bottom-full`) and the table wrapper must NOT have `overflow-hidden` or `overflow-x-auto` — otherwise the menu is clipped.

### Edge Function calls — direct fetch, not `functions.invoke()`
`supabase.functions.invoke()` from the browser client is unreliable. Use `fetch()` to `${SUPABASE_URL}/functions/v1/<name>` with a `Bearer ${session?.access_token ?? anon_key}` header.

### Guest OTP verification before booking
Guest users (no session) must verify their email via OTP before submission. Inline OTP step appears in `/book/confirm` after form validation; on success the booking is submitted automatically. Logged-in users skip verification. After a successful guest booking, `confirm-form.tsx` non-blocking links `profiles.contact_id` to the contact record.

### Privacy: residents excluded from admin users page
`/admin/users` filters out `resident` and `strata` roles via `.not('role', 'in', '("resident","strata")')`. Self-service only — admins don't see the resident list.

### `for_mud=true` collection_date gotcha
MUD bookings only see `collection_date` rows where `for_mud = true`. Easy to forget when seeding new dates — the date dropdown silently shows empty if no flagged dates exist for the area.

---

*Keep this file current. If a decision changes in the PRD or TECH_SPEC, update CLAUDE.md in the same PR. Session-by-session decision context lives in `~/.claude/memory/verco/session-log.md` — do not duplicate it here.*
