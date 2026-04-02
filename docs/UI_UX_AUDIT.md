# UI/UX Audit — Verco v2

**Date:** 02/04/2026
**Scope:** Full codebase audit — resident pages, admin pages, design system

---

## Priority 1 — Design Tokens (Brand Colours)

**Problem:** 426+ hardcoded hex colour values across the codebase. A brand colour change requires find-and-replace across 150+ files.

**Top offenders:**

| Colour | Hex | Approx. Usage |
|---|---|---|
| Navy (primary) | `#293F52` | ~150 |
| Green (accent) | `#00E47C` | ~50 |
| Green dark | `#00B864` | ~15 |
| Red (destructive) | `#E53E3E` | ~20 |
| Red light bg | `#FFF0F0` | ~10 |
| Orange (warning) | `#FF8C42` | ~20 |
| Green light bg | `#E8FDF0` | ~15 |
| Blue (info) | `#3182CE` | ~10 |

**Fix:**

1. Add brand colours to `@theme inline` block in `src/app/globals.css`:
   ```css
   --color-navy: #293F52;
   --color-green: #00E47C;
   --color-green-dark: #00B864;
   --color-red: #E53E3E;
   --color-red-light: #FFF0F0;
   --color-orange: #FF8C42;
   --color-green-light: #E8FDF0;
   --color-blue: #3182CE;
   ```
2. Migrate incrementally — start with the 5 most-used colours (`#293F52`, `#00E47C`, `#00B864`, `#E53E3E`, `#E8FDF0`)
3. Use `text-[var(--color-navy)]` / `bg-[var(--color-green)]` pattern until Tailwind v4 theme extension is configured

**Files with most violations:**
- `src/components/tickets/service-ticket-form.tsx` (20+)
- `src/app/(public)/page.tsx` (15+)
- `src/app/(public)/auth/email-entry-form.tsx` (8+)
- `src/components/booking/booking-status-badge.tsx` (10)
- `src/app/(field)/field/booking/[ref]/mud-allocation-form.tsx` (12+)

**Effort:** 2-3 hours | **Impact:** High

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
P1: Design tokens (colours)     ████████████░░░░  2-3 hrs
P2: Button component            ██████░░░░░░░░░░  1-2 hrs
P3: Loading states              ████░░░░░░░░░░░░  1 hr
P4: Typography scale            ████████░░░░░░░░  2 hrs
P5: Status style configs        ██░░░░░░░░░░░░░░  30 min
P6: Accessibility quick wins    ████░░░░░░░░░░░░  1 hr
P7: Remove dark mode CSS        █░░░░░░░░░░░░░░░  15 min
P8: Admin mobile (defer)        ████████████████  4+ hrs
                                ─────────────────
                                Total: ~10-12 hrs (excl. P8)
```
