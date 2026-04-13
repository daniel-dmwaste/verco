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

**Schema naming:** `category` = capacity grouping (Bulk/Ancillary/ID, `code` column). `service` = individual types (FK → category). `allocation_rules` = per area per category. `service_rules` = per area per service. `booking_item.service_id` → FK to `service` (not `service_type`).

**Key rules:** Portal is branded at **client** level. Address lookup resolves to a **collection area** — never ask resident to select one. Sub-clients are optional. `dm_job_code` on `collection_area` is DM-Ops sync metadata only.

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
- **Never use `is_contractor_user()` in RLS policies gating PII** — it includes `field`. Use explicit `current_user_role() IN ('contractor-admin', 'contractor-staff')` instead

**Privacy rule — `resident`/`strata` excluded from admin user management:**
Admin users pages filter out `resident` and `strata` roles from queries and dropdowns. These roles are self-service only — admin users should not see the full resident list.

---

## 5. Supabase Client Usage

Two clients exist — `lib/supabase/server.ts` (server) and `lib/supabase/client.ts` (browser). Read the source files for implementation.

- **Always use the anon key** in both clients — RLS does the access control
- **Never use the service role key** in any client-side or server component code — it must stay in `supabase/functions/`
- Use **server client** in: `app/**/page.tsx`, `app/**/layout.tsx`, `app/api/**/route.ts`, server actions (`'use server'`)
- Use **browser client** in: files with `'use client'` directive, custom hooks in `hooks/`

---

## 6. Pricing Engine — Hard Rules

```
NEVER accept unit_price_cents from the client.
NEVER calculate price in a client component.
NEVER skip the server-side price recalculation on booking creation.
```

**Flow:** Client calls `calculate-price` EF → displays result → on confirm, `create-booking` EF **re-runs** `calculatePrice` internally (never trusts client price) → rejects if price differs.

### Dual-limit free unit calculation

A unit becomes paid (extra) when EITHER limit is exhausted:

```
category_remaining = allocation_rules.max_collections - FY usage across ALL services in that category
service_remaining  = service_rules.max_collections - FY usage for THIS specific service
free_units         = MIN(requested_qty, category_remaining, service_remaining)
paid_units         = requested_qty - free_units
```

**Only free_units consume category budget** — paid units do not reduce the remaining count.

Authoritative implementation: `supabase/functions/_shared/pricing.ts`. Node extraction: `src/lib/pricing/calculate.ts` (tested with Vitest, keep in sync). Client preview in `services-form.tsx` mirrors for display only.

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

### NCN/NP State Machine

Non-conformance notices and nothing presented records follow a separate state flow from bookings:

```
Issued → Disputed         (resident, within 14 days)
Issued → Closed           (auto-close cron, after 14 days with no dispute)
Disputed → Under Review   (staff)
Under Review → Resolved   (staff — NCN)
Under Review → Rescheduled (staff — NCN with rebook)
Under Review → Rebooked   (staff — NP)
```

- Default status is `Issued` (not `Open` — `Open` enum value kept but unused)
- Staff can only investigate/resolve `Disputed` or `Under Review` notices — never `Issued`
- Resident dispute is RLS-enforced: policies constrain to `Issued → Disputed` on own bookings only

---

## 8. TypeScript Conventions

- **Strict mode always on** — `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns` in tsconfig
- **Never use `any`** — always use generated types from `lib/supabase/types.ts`
- **Regenerate types after every migration** — see §18 Commands
- **Zod schemas for all external inputs** — every API route, server action, and Edge Function
- **Result pattern** — use `Result<T, E = string>` (`{ ok: true, data }` | `{ ok: false, error }`) — never throw across async boundaries

---

## 9. File & Folder Conventions

### Naming
- **Files:** `kebab-case.tsx` / `kebab-case.ts`
- **Components:** `PascalCase` named export
- **Hooks:** `useCamelCase` — always prefix with `use`
- **Server actions:** `camelCase` in `app/**/actions.ts`
- **Utilities:** `camelCase` in `lib/utils/`

### Component co-location
Keep components close to where they're used. Only promote to `components/` when used in 3+ places. Co-locate single-use components and hooks in the same directory as their page.

### Server vs. client components
Default to **server components**. Add `'use client'` only when you need `useState`/`useReducer`, `useEffect`, browser APIs, or event handlers that can't be server actions.

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

**Route guards:** `/field/*` → field/ranger. `/admin/*` → staff roles. `/dashboard` → authenticated. `/book/*` and `/survey/*` → public.

The resolved `client_id`, `client_slug`, and `contractor_id` are set as **request** headers (`x-client-id`, `x-client-slug`, `x-contractor-id`) via `NextResponse.next({ request: { headers } })` — NOT response headers. Read via `headers()` in server components and actions. Never re-query for these in downstream code.

---

## 11. Edge Functions

All Edge Functions live in `supabase/functions/`. Each function is a single `index.ts` file. Shared code in `_shared/`. See `docs/VERCO_V2_TECH_SPEC.md` §10 for contracts. Follow the pattern of existing functions (auth → parse → validate → execute).

### Rules
- **Public route functions** (e.g. `calculate-price`, `google-places-proxy`) must accept anon key only — do not require `auth.getUser()` to succeed
- **Service role** only for: `nightly-sync-to-dm-ops`, `stripe-webhook`, `audit_log` writes, batch admin ops — document why with a comment
- **Error handling** — catch blocks must return `err.message`, not generic strings. Include `rpcError.message` on RPC failures
- **Calling from Next.js** — use direct `fetch()` with explicit URL/headers, not `supabase.functions.invoke()` (unreliable in SSR)

---

## 12. RLS — What Claude Code Must Know

RLS is the primary security layer. Application code is defence-in-depth, not the first line of defence. See `docs/VERCO_V2_TECH_SPEC.md` §6 for full policy details and helper function reference.

### Rules
- **New tables:** enable RLS immediately, write policies before application code, default to deny
- **Never use service role to bypass RLS** in application code — and never filter by `client_id` manually (RLS handles scoping)
- **Public SELECT tables** (no auth required): `client`, `collection_area`, `eligible_properties`, `collection_date`, `category`, `service`, `service_rules`, `allocation_rules`, `financial_year`
- **Cross-table RLS policies** that cause recursion: wrap lookups in `SECURITY DEFINER` functions (see `current_user_contact_id_by_email()` for pattern)

---

## 13. Capacity — Concurrency Rules

**Never check capacity in application code and then insert separately.** Always use the `create_booking_with_capacity_check` RPC — it wraps capacity check + insert in a serialisable transaction with a Postgres advisory lock. See `docs/VERCO_V2_TECH_SPEC.md` §9 for details.

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
1. Unit tests for business logic (`src/__tests__/`)
2. E2E test for user-facing flows (`tests/e2e/`)
3. RLS test if a new table or policy is added

---

## 15. What Not To Build

These are explicitly out of scope for v2. If a task seems to require one of these, stop and check with Dan before proceeding.

| Out of scope | Why |
|---|---|
| OptimoRoute integration | Future — schema has nullable `optimo_stop_id` placeholder only |
| Stripe Connect | Future — `client_id` on payments is prep only |
| Cross-client benchmarking in reports | Explicitly excluded — tenant data only |
| Email template management UI | Templates are code-defined in Edge Functions |
| Xero integration | Lives in DM-Ops only |
| Any DM-Ops tables | `docket`, `timesheet`, `employee`, `crew`, `asset`, `tender`, `purchase_order`, `invoice` — not in this schema |
| `dm-admin` / `dm-staff` / `dm-field` roles | These are DM-Ops roles — Verco v2 does not have them |

---

## 16. Environment Variables

See `docs/VERCO_V2_TECH_SPEC.md` §16 for full list. Key rule:

- **`NEXT_PUBLIC_*`** — safe for browser (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STRIPE_PUBLISHABLE_KEY`)
- **`SUPABASE_SERVICE_ROLE_KEY`** — Edge Functions only. **If you need it in `app/` — stop. You are doing something wrong.**
- **Edge Function secrets** — set in Supabase dashboard, never in `.env`

---

## 17. Git Conventions

- **Branches:** `feature/`, `fix/`, `chore/` prefixes
- **Commits:** Conventional commits (`feat:`, `fix:`, `chore:`, `test:`)
- **Never commit:** `.env*`, `supabase/.temp/`

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
Any client component using `useSearchParams()` must be wrapped in `<Suspense>`.

### Postgres numeric → JavaScript number
Supabase returns `numeric` columns as strings. Coerce with `Number()` before passing to components (e.g., Leaflet maps).

### Tailwind CSS 4 configuration
All theme config in `@theme inline` block in `globals.css` (no `tailwind.config.ts`). Font families: `--font-sans` (DM Sans), `--font-heading` (Poppins) via `font-[family-name:var(--font-heading)]`.

### Booking wizard layout
`app/(public)/book/layout.tsx` wraps all `/book/*` pages with max-width + padding via inline styles (Tailwind classes were not rendering reliably). Individual step forms use `flex flex-col` only — no `min-h-screen` or `bg-*` (layout handles those).

### Admin page pattern
List pages: `<Suspense><Client /></Suspense>`. Client uses `useQuery` + browser Supabase. Header: `border-b border-gray-100 bg-white px-7 pb-5 pt-6`. RLS handles tenant scoping.

### Desktop layout conventions
Public pages: `<main className="mx-auto w-full max-w-5xl px-6 py-8">` at server page level. `bg-gray-50 min-h-screen` on `app/(public)/layout.tsx`. Bottom nav: `pb-16 tablet:pb-0`.

### Tailwind v4 breakpoints
`tablet:` (1024px) for nav/layout switching only. `md:` for text sizing and spacing.

### Supabase MCP migrations — verify DDL executed
`apply_migration` can register a version without DDL running. Always verify with `execute_sql` (`SELECT EXISTS (...)`) after applying.

### RLS on new columns — check UPDATE policies exist
Adding a column doesn't grant UPDATE. If the table lacks an UPDATE policy, writes silently fail. Check `pg_policies` and add if missing.

### White-label colours — use `var(--brand)` not hardcoded hex
Public/field pages use CSS variables (`--brand`, `--brand-accent` + derived `-light`/`-hover`/`-dark`). Never hardcode `#293F52`/`#00E47C` in public/field — admin pages are exempt.

### Typography — use semantic tokens, not arbitrary px
`text-2xs`(10), `text-body-sm`(13), `text-body`(15), `text-subtitle`(17), `text-title`(22), `text-display`(28). Exception: `text-[11px]` has no token.

### Booking wizard state — URL params are the source of truth
Every wizard step carries ALL params through back/forward nav via `carryParams`. When adding a param, update all steps.

### EFs that access PII accept dual auth (per §20 Red Line #3)
Server actions MUST NOT use the service role key. EFs needing PII (e.g. `send-notification`) accept EITHER a service role bearer (EF→EF callers) OR a valid user JWT whose `current_user_role()` is in a permitted set. Internal loads always use service role inside the EF — the user's role gates the TRIGGER, not the data access.
