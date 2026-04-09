# UI/UX Audit — Verco v2

**Date:** 02/04/2026
**Scope:** Full codebase audit — resident pages, admin pages, design system

---

## Priority 1 — White-Label Colour System

**Problem:** The platform is white-labelled per client, but branding doesn't work. `client.primary_colour` exists in the DB and `--color-primary` is already injected as a CSS variable in `src/app/(public)/layout.tsx:67` — but all 150+ references to `#293F52` are hardcoded hex, so the variable is ignored. Every tenant currently looks like D&M branding regardless of their `primary_colour` setting.

Additionally, 426+ hardcoded hex colour values across the codebase means any design change requires find-and-replace across 150+ files.

### Step 1 — Add `accent_colour` to `client` table

Currently only `primary_colour` exists. Add a second field for the accent/CTA colour (the green `#00E47C` equivalent — councils may want a different highlight colour).

**Migration:**
```sql
ALTER TABLE client ADD COLUMN accent_colour text;
-- Default: null (falls back to #00E47C in CSS)
```

**DB fields after change:**
| Field | Purpose | D&M Default | Example (other council) |
|---|---|---|---|
| `primary_colour` | Nav, buttons, headings, text | `#293F52` (navy) | `#1B4F72` (dark blue) |
| `accent_colour` | CTAs, success states, highlights | `#00E47C` (green) | `#F39C12` (gold) |

### Step 2 — Inject both colours + derived shades as CSS variables

**File:** `src/app/(public)/layout.tsx`

The layout already sets `--color-primary`. Extend to include accent and derived shades using CSS `color-mix()`:

```tsx
const primaryColour = branding?.primary_colour ?? '#293F52'
const accentColour = branding?.accent_colour ?? '#00E47C'

// In the style prop:
style={{
  '--color-primary': primaryColour,
  '--color-primary-light': `color-mix(in srgb, ${primaryColour} 8%, white)`,
  '--color-primary-hover': `color-mix(in srgb, ${primaryColour} 85%, black)`,
  '--color-accent': accentColour,
  '--color-accent-light': `color-mix(in srgb, ${accentColour} 10%, white)`,
  '--color-accent-dark': `color-mix(in srgb, ${accentColour} 75%, black)`,
} as React.CSSProperties}
```

This gives each tenant a full palette from just 2 DB fields — no extra columns needed for light/dark/hover variants.

### Step 3 — Add fallback defaults to `globals.css`

**File:** `src/app/globals.css` (in the `@theme inline` block)

```css
/* White-label brand colours — overridden per-tenant via layout.tsx inline style */
--color-primary: #293F52;
--color-primary-light: color-mix(in srgb, #293F52 8%, white);
--color-primary-hover: color-mix(in srgb, #293F52 85%, black);
--color-accent: #00E47C;
--color-accent-light: color-mix(in srgb, #00E47C 10%, white);
--color-accent-dark: color-mix(in srgb, #00E47C 75%, black);

/* Fixed colours — not tenant-branded */
--color-red: #E53E3E;
--color-red-light: #FFF0F0;
--color-orange: #FF8C42;
--color-blue: #3182CE;
```

### Step 4 — Replace hardcoded hex values with CSS variables

**Mapping:**

| Hardcoded | CSS Variable | Scope |
|---|---|---|
| `#293F52` (text, borders, bg) | `var(--color-primary)` | Public pages only |
| `#1A2D3B` (dark navy) | `var(--color-primary-hover)` | Public pages only |
| `#00E47C` (accent green) | `var(--color-accent)` | Public pages only |
| `#00B864` (dark green) | `var(--color-accent-dark)` | Public pages only |
| `#E8FDF0` (light green bg) | `var(--color-accent-light)` | Public pages only |
| `#E53E3E` (red) | `var(--color-red)` | All pages (fixed) |
| `#FFF0F0` (red light bg) | `var(--color-red-light)` | All pages (fixed) |
| `#FF8C42` (orange) | `var(--color-orange)` | All pages (fixed) |

**Usage pattern:**
```tsx
// Before
className="text-[#293F52] bg-[#E8FDF0] border-[#00E47C]"

// After
className="text-[var(--color-primary)] bg-[var(--color-accent-light)] border-[var(--color-accent)]"
```

**Migration order (public pages first — these are tenant-branded):**
1. `src/app/(public)/page.tsx` (landing — 15+ refs)
2. `src/app/(public)/auth/email-entry-form.tsx` (8+ refs)
3. `src/components/public/public-nav.tsx` (nav branding)
4. `src/components/public/mobile-bottom-nav.tsx`
5. `src/app/(public)/book/**` (wizard — 30+ refs across 5 files)
6. `src/app/(public)/booking/[ref]/**` (booking detail)
7. `src/app/(public)/dashboard/**`
8. `src/components/booking/booking-status-badge.tsx` (10 refs)
9. `src/components/tickets/service-ticket-form.tsx` (20+ refs)

**Admin pages (`src/app/(admin)/`)** — keep hardcoded to D&M branding for now. Admin is contractor-scoped, not tenant-branded. Can convert later if needed.

**Field pages (`src/app/(field)/`)** — convert alongside public pages (field staff see tenant branding).

### Step 5 — Update tenant API route

**File:** `src/app/api/tenant/route.ts`

Add `accent_colour` to the select query so client-side components can access it if needed.

### Verification

1. Set a test client's `primary_colour` to something obvious (e.g., `#FF0000`)
2. Set `accent_colour` to `#0000FF`
3. Load the tenant's public pages — all branded elements should reflect the new colours
4. Confirm admin pages remain D&M navy
5. Confirm null values fall back to defaults (#293F52 / #00E47C)
6. `pnpm tsc --noEmit` — clean build

**Effort:** 3-4 hours | **Impact:** Critical — white-labelling is broken without this

---

## Priority 2 — Shared Button Component

**Problem:** The shadcn/ui `Button` component (`src/components/ui/button.tsx`) exists but is never used. Every button is hand-rolled with slight variations:

| Variant | Height | Text Size | Hover | Example File |
|---|---|---|---|---|
| Primary (navy) | `h-[52px]` | `text-[15px]` | `hover:opacity-90` | `auth/email-entry-form.tsx` |
| Secondary (outline) | `h-[52px]` | `text-[15px]` | `hover:opacity-90` | `book/date/date-form.tsx` |
| Destructive (red) | `h-[52px]` | `text-[15px]` | `hover:opacity-90` | `booking-cancel-link.tsx` |
| Success (green) | unconstrained | `text-sm` | none | `mud-allocation-form.tsx` |

**Fix:**

1. Create `src/components/ui/verco-button.tsx` (or extend existing `button.tsx`) with 4 variants:
   - `primary` — navy bg, white text
   - `secondary` — white bg, navy text, gray border
   - `destructive` — red light bg, red text, red border
   - `success` — green bg, navy text
2. Two sizes: `default` (`h-[52px]` for wizard/form actions) and `sm` (`h-10` for table/inline actions)
3. All variants: `rounded-xl`, `text-[15px]`, `font-semibold`, `font-[family-name:var(--font-heading)]`, `hover:opacity-90`, `disabled:opacity-50`
4. Migrate wizard buttons first (4 step files + cancel link), then admin, then auth

**Effort:** 1-2 hours | **Impact:** High

---

## Priority 3 — Loading States

**Problem:** Multiple async queries run silently with no visual feedback.

| Location | Query | Current State |
|---|---|---|
| `book/services/services-form.tsx` | Service rules + allocations | No loading indicator |
| `book/date/date-form.tsx` | Available collection dates | No loading indicator |
| `book/address-form.tsx` | Property lookup | No loading indicator |
| All admin list pages | Table data | "Loading..." text only |

**Fix:**

1. Create a simple `<Spinner />` component (or use an existing one if shadcn has it)
2. Add `{isLoading && <Spinner />}` to each `useQuery` consumer
3. For admin tables: replace "Loading..." text with 3-5 skeleton table rows
4. For wizard steps: show spinner in the content area while data loads

**Effort:** 1 hour | **Impact:** High (perceived performance)

---

## Priority 4 — Typography Scale

**Problem:** 30+ arbitrary pixel values instead of Tailwind's standard scale.

**Current → Recommended mapping:**

| Current | Tailwind Equivalent | Usage |
|---|---|---|
| `text-[10px]` | `text-[10px]` (keep — no Tailwind match) | Tiny labels only |
| `text-[11px]` | `text-[11px]` (keep — badge text) | Status badges |
| `text-[13px]` | `text-sm` (14px) | Descriptions, secondary text |
| `text-[15px]` | `text-base` (16px) | Buttons, form inputs, body |
| `text-[17px]` | `text-lg` (18px) | Card headings |
| `text-[22px]` | `text-xl` (20px) or `text-2xl` (24px) | Page headings |
| `text-[28px]` | `text-2xl` (24px) or `text-3xl` (30px) | Section headings |
| `text-[52px]` | `text-5xl` (48px) | Hero only |

**Fix:**

1. Decide: keep `text-[11px]` for badges (no standard match) — acceptable one-off
2. Replace `text-[13px]` → `text-sm` across the board
3. Replace `text-[15px]` → `text-base` for buttons and inputs
4. Replace `text-[22px]` → `text-xl` for page headings
5. Do this per-page, starting with public pages (highest visibility)

**Effort:** 2 hours | **Impact:** Medium (visual consistency)

---

## Priority 5 — Shared Status Style Configs

**Problem:** `STATUS_STYLE` / `STATUS_CONFIG` objects are defined independently in 5+ files with slightly different colour mappings.

**Files with duplicated status styles:**
- `src/components/booking/booking-status-badge.tsx` — booking statuses
- `src/app/(admin)/admin/non-conformance/non-conformance-client.tsx` — NCN statuses
- `src/app/(admin)/admin/nothing-presented/nothing-presented-client.tsx` — NP statuses
- `src/app/(admin)/admin/refunds/refunds-client.tsx` — refund statuses
- `src/app/(admin)/admin/bookings/bookings-list-client.tsx` — booking type dots

**Fix:**

1. Create `src/lib/ui/status-styles.ts`
2. Export `getStatusBadgeClasses(entity: 'booking' | 'ncn' | 'np' | 'refund', status: string): { bg: string; text: string }`
3. Single source of truth for all status → colour mappings
4. Update each consumer to import from shared module

**Effort:** 30 minutes | **Impact:** Medium (DRY, easier to update)

---

## Priority 6 — Accessibility (Quick Wins)

**Problem:** No `aria-label` on interactive elements, no `role="alert"` on dynamic banners, emoji used as icons.

**Quick wins (highest ROI):**

| Fix | Where | Effort |
|---|---|---|
| Add `aria-label` to icon-only buttons (edit pencils, close X, three-dot menus) | Admin detail panels, table action columns | 30 min |
| Add `role="alert" aria-live="polite"` to error/success banners | Address form, confirm form, admin actions | 15 min |
| Add `aria-hidden="true"` to emoji icons + `<span className="sr-only">` with text | Address form, booking detail | 15 min |
| Add `aria-label` to filter selects (status, area, type) | All admin list pages | 15 min |

**Defer for later:**
- Skip-to-content link
- Full keyboard navigation audit
- Focus trapping in custom modals (Base UI Dialog handles this already)
- Colour contrast audit (run axe-core or Lighthouse)

**Effort:** 1 hour | **Impact:** Medium

---

## Priority 7 — Remove Unused Dark Mode CSS

**Problem:** `globals.css` has 30+ lines of dark mode OKLCH variables. Only 4 `dark:` prefixes exist in the entire codebase (all in the unused shadcn Button component). Dead config creates confusion.

**Fix:**

1. Remove the `@media (prefers-color-scheme: dark)` block from `globals.css` (lines ~88-120)
2. Remove `dark:` prefixes from `src/components/ui/button.tsx` (or leave — component is unused anyway)
3. Add comment: `/* Dark mode: not implemented in v2. See docs/UI_UX_AUDIT.md for future plans. */`

**Effort:** 15 minutes | **Impact:** Low (cleanup)

---

## Priority 8 — Admin Mobile Responsiveness

**Problem:** Admin pages are desktop-only. Fixed 400px detail sidebar, non-collapsing sidebar nav, non-stacking tables.

**Assessment:** Admin users are primarily desktop (council staff, contractor office staff). Field staff use the separate `/field/` route group which IS mobile-optimised. This is acceptable short-term.

**If needed later:**

| Fix | Effort |
|---|---|
| Collapsible sidebar nav (hamburger on mobile) | 2 hrs |
| Detail panel as full-screen overlay on mobile | 2 hrs |
| Responsive table (hide low-priority columns on mobile) | 1 hr per table |
| Filter section wrap/collapse | 30 min |

**Effort:** 4+ hours | **Impact:** Low (desktop-primary audience)

---

## Spacing & Border Radius Standardisation

**Not a standalone task** — address incrementally alongside Priorities 1-4.

**Spacing rules to follow:**
- Page-level horizontal padding: `px-6` (public), `px-7` (admin) — keep as-is, different contexts
- Component internal padding: `px-4` (standard), `px-3` (tight/compact)
- Button padding: `px-3.5 py-3.5` (standard)
- Form input padding: `px-3.5 py-3` (standard)

**Border radius rules:**
- Cards and buttons: `rounded-xl`
- Form inputs: `rounded-[10px]` (existing convention — keep)
- Badges: `rounded-full`
- Modals: `rounded-xl`
- Admin table containers: `rounded-xl`

---

## What's Already Good

These patterns should be preserved, not refactored:

- Form input styling is consistent (`rounded-[10px] border-[1.5px] border-gray-100`)
- Booking status badge is centralised (`booking-status-badge.tsx`)
- URL-param state management in booking wizard is solid
- Base UI Dialog for confirmations (consistent pattern)
- React Query usage across admin pages
- RLS-backed data fetching (no manual scoping needed)
- Responsive public pages (`md:grid-cols-2` stacking)
- Mobile bottom nav with `pb-16 tablet:pb-0` padding

---

## Implementation Order

```
P1: White-label colour system   ████████████████  3-4 hrs  ← DO FIRST
P2: Button component            ██████░░░░░░░░░░  1-2 hrs
P3: Loading states              ████░░░░░░░░░░░░  1 hr
P4: Typography scale            ████████░░░░░░░░  2 hrs
P5: Status style configs        ██░░░░░░░░░░░░░░  30 min
P6: Accessibility quick wins    ████░░░░░░░░░░░░  1 hr
P7: Remove dark mode CSS        █░░░░░░░░░░░░░░░  15 min
P8: Admin mobile (defer)        ████████████████  4+ hrs
                                ─────────────────
                                Total: ~12-14 hrs (excl. P8)
```

**Note:** P1 subsumes the old "design tokens" task. Migrating hardcoded hex → CSS variables IS the white-label fix — they're the same work.
