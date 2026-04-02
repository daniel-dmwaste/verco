import { describe, it, expect } from 'vitest'
import {
  computeLineItems,
  type PricingItem,
  type ServiceRule,
  type AllocationOverride,
} from '@/lib/pricing/calculate'

// Helpers to build maps concisely
function rules(entries: [string, ServiceRule][]): Map<string, ServiceRule> {
  return new Map(entries)
}
function catMax(entries: [string, number][]): Map<string, number> {
  return new Map(entries)
}
function svcCat(entries: [string, string][]): Map<string, string> {
  return new Map(entries)
}
function usage(entries: [string, number][]): Map<string, number> {
  return new Map(entries)
}
const empty = () => new Map()

// Reusable IDs
const SVC_GENERAL = 'svc-general'
const SVC_GREEN = 'svc-green'
const SVC_MATTRESS = 'svc-mattress'
const SVC_EWASTE = 'svc-ewaste'
const CAT_BULK = 'bulk'
const CAT_ANC = 'anc'

describe('computeLineItems', () => {
  // ── Basic free/paid ────────────────────────────────────

  describe('basic free/paid allocation', () => {
    it('all free — quantity within both category and service limits', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 2 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items).toHaveLength(1)
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(0)
      expect(result.line_items[0]!.is_extra).toBe(false)
      expect(result.total_cents).toBe(0)
    })

    it('all paid — both limits exhausted', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        usage([[SVC_GENERAL, 5]]),  // service fully used
        usage([[CAT_BULK, 5]]),     // category fully used
      )
      expect(result.line_items[0]!.free_units).toBe(0)
      expect(result.line_items[0]!.paid_units).toBe(3)
      expect(result.line_items[0]!.is_extra).toBe(true)
      expect(result.total_cents).toBe(3 * 5000)
    })

    it('partial free — service limit is binding', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 2, extra_unit_price: 40 }]]),
        catMax([[CAT_BULK, 10]]),   // category has plenty
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(1)
      expect(result.line_items[0]!.line_charge_cents).toBe(4000)
    })

    it('partial free — category limit is binding', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 10, extra_unit_price: 40 }]]),
        catMax([[CAT_BULK, 2]]),    // category is the constraint
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(1)
      expect(result.line_items[0]!.line_charge_cents).toBe(4000)
    })
  })

  // ── Dual-limit MIN logic ───────────────────────────────

  describe('dual-limit MIN(qty, category_remaining, service_remaining)', () => {
    it('quantity is smallest', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 1 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(1)
      expect(result.line_items[0]!.paid_units).toBe(0)
    })

    it('category_remaining is smallest', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 5 }],
        rules([[SVC_GENERAL, { max_collections: 10, extra_unit_price: 30 }]]),
        catMax([[CAT_BULK, 2]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(3)
    })

    it('service_remaining is smallest', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 5 }],
        rules([[SVC_GENERAL, { max_collections: 3, extra_unit_price: 30 }]]),
        catMax([[CAT_BULK, 10]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(3)
      expect(result.line_items[0]!.paid_units).toBe(2)
    })

    it('exact boundary — all three equal', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 3, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 3]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(3)
      expect(result.line_items[0]!.paid_units).toBe(0)
      expect(result.total_cents).toBe(0)
    })
  })

  // ── Cross-item category budget (categoryFormUsed) ──────

  describe('cross-item category budget consumption', () => {
    it('two items same category — first consumes budget, second gets fewer free', () => {
      const result = computeLineItems(
        [
          { service_id: SVC_GENERAL, quantity: 3 },
          { service_id: SVC_GREEN, quantity: 3 },
        ],
        rules([
          [SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }],
          [SVC_GREEN, { max_collections: 5, extra_unit_price: 40 }],
        ]),
        catMax([[CAT_BULK, 4]]),   // only 4 free across the category
        svcCat([
          [SVC_GENERAL, CAT_BULK],
          [SVC_GREEN, CAT_BULK],
        ]),
        empty(),
        empty(),
      )
      // General takes 3 free (of 4 category budget)
      expect(result.line_items[0]!.free_units).toBe(3)
      expect(result.line_items[0]!.paid_units).toBe(0)
      // Green gets only 1 free (4 - 3 = 1 remaining)
      expect(result.line_items[1]!.free_units).toBe(1)
      expect(result.line_items[1]!.paid_units).toBe(2)
      expect(result.line_items[1]!.line_charge_cents).toBe(2 * 4000)
    })

    it('three items progressive depletion of category budget', () => {
      const result = computeLineItems(
        [
          { service_id: SVC_GENERAL, quantity: 2 },
          { service_id: SVC_GREEN, quantity: 2 },
          { service_id: SVC_MATTRESS, quantity: 2 },
        ],
        rules([
          [SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }],
          [SVC_GREEN, { max_collections: 5, extra_unit_price: 40 }],
          [SVC_MATTRESS, { max_collections: 5, extra_unit_price: 60 }],
        ]),
        catMax([[CAT_BULK, 5]]),
        svcCat([
          [SVC_GENERAL, CAT_BULK],
          [SVC_GREEN, CAT_BULK],
          [SVC_MATTRESS, CAT_BULK],
        ]),
        empty(),
        empty(),
      )
      // General: 2 free (5 - 0 = 5 remaining, min(2, 5, 5) = 2)
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(0)
      // Green: 2 free (5 - 2 = 3 remaining, min(2, 3, 5) = 2)
      expect(result.line_items[1]!.free_units).toBe(2)
      expect(result.line_items[1]!.paid_units).toBe(0)
      // Mattress: 1 free (5 - 4 = 1 remaining, min(2, 1, 5) = 1)
      expect(result.line_items[2]!.free_units).toBe(1)
      expect(result.line_items[2]!.paid_units).toBe(1)
    })

    it('two different categories — independent budgets', () => {
      const result = computeLineItems(
        [
          { service_id: SVC_GENERAL, quantity: 3 },
          { service_id: SVC_MATTRESS, quantity: 3 },
        ],
        rules([
          [SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }],
          [SVC_MATTRESS, { max_collections: 5, extra_unit_price: 60 }],
        ]),
        catMax([
          [CAT_BULK, 3],
          [CAT_ANC, 3],
        ]),
        svcCat([
          [SVC_GENERAL, CAT_BULK],
          [SVC_MATTRESS, CAT_ANC],
        ]),
        empty(),
        empty(),
      )
      // Each gets full 3 free from their own category
      expect(result.line_items[0]!.free_units).toBe(3)
      expect(result.line_items[0]!.paid_units).toBe(0)
      expect(result.line_items[1]!.free_units).toBe(3)
      expect(result.line_items[1]!.paid_units).toBe(0)
      expect(result.total_cents).toBe(0)
    })

    it('mixed categories — one depleted, one independent', () => {
      const result = computeLineItems(
        [
          { service_id: SVC_GENERAL, quantity: 2 },
          { service_id: SVC_GREEN, quantity: 2 },
          { service_id: SVC_MATTRESS, quantity: 2 },
        ],
        rules([
          [SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }],
          [SVC_GREEN, { max_collections: 5, extra_unit_price: 40 }],
          [SVC_MATTRESS, { max_collections: 5, extra_unit_price: 60 }],
        ]),
        catMax([
          [CAT_BULK, 3],  // General + Green share this
          [CAT_ANC, 5],   // Mattress has its own
        ]),
        svcCat([
          [SVC_GENERAL, CAT_BULK],
          [SVC_GREEN, CAT_BULK],
          [SVC_MATTRESS, CAT_ANC],
        ]),
        empty(),
        empty(),
      )
      // General: 2 free (min(2, 3, 5) = 2)
      expect(result.line_items[0]!.free_units).toBe(2)
      // Green: 1 free (3 - 2 = 1 cat remaining, min(2, 1, 5) = 1)
      expect(result.line_items[1]!.free_units).toBe(1)
      expect(result.line_items[1]!.paid_units).toBe(1)
      // Mattress: 2 free (independent category, min(2, 5, 5) = 2)
      expect(result.line_items[2]!.free_units).toBe(2)
      expect(result.line_items[2]!.paid_units).toBe(0)
    })
  })

  // ── Price math ─────────────────────────────────────────

  describe('price calculations', () => {
    it('unit_price_cents = round(extra_unit_price * 100)', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 2 }],
        rules([[SVC_GENERAL, { max_collections: 0, extra_unit_price: 49.99 }]]),
        catMax([[CAT_BULK, 0]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.unit_price_cents).toBe(4999)
    })

    it('rounds fractional cents correctly', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 1 }],
        rules([[SVC_GENERAL, { max_collections: 0, extra_unit_price: 49.995 }]]),
        catMax([[CAT_BULK, 0]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      // 49.995 * 100 = 4999.5 → rounds to 5000
      expect(result.line_items[0]!.unit_price_cents).toBe(5000)
    })

    it('line_charge_cents = paid_units * unit_price_cents', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 5 }],
        rules([[SVC_GENERAL, { max_collections: 2, extra_unit_price: 30 }]]),
        catMax([[CAT_BULK, 10]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      // 3 paid * 3000 cents = 9000
      expect(result.line_items[0]!.paid_units).toBe(3)
      expect(result.line_items[0]!.line_charge_cents).toBe(9000)
    })

    it('total_cents sums all line charges', () => {
      const result = computeLineItems(
        [
          { service_id: SVC_GENERAL, quantity: 3 },
          { service_id: SVC_MATTRESS, quantity: 2 },
        ],
        rules([
          [SVC_GENERAL, { max_collections: 1, extra_unit_price: 50 }],
          [SVC_MATTRESS, { max_collections: 0, extra_unit_price: 60 }],
        ]),
        catMax([
          [CAT_BULK, 10],
          [CAT_ANC, 10],
        ]),
        svcCat([
          [SVC_GENERAL, CAT_BULK],
          [SVC_MATTRESS, CAT_ANC],
        ]),
        empty(),
        empty(),
      )
      // General: 2 paid * 5000 = 10000
      // Mattress: 2 paid * 6000 = 12000
      expect(result.total_cents).toBe(22000)
    })

    it('all-free booking produces total_cents = 0', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 1 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.total_cents).toBe(0)
    })
  })

  // ── is_extra flag ──────────────────────────────────────

  describe('is_extra flag', () => {
    it('false when paid_units = 0', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 1 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.is_extra).toBe(false)
    })

    it('true when paid_units > 0', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 1, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 10]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.is_extra).toBe(true)
    })
  })

  // ── Edge cases ─────────────────────────────────────────

  describe('edge cases', () => {
    it('empty items array', () => {
      const result = computeLineItems([], empty(), empty(), empty(), empty(), empty())
      expect(result.line_items).toHaveLength(0)
      expect(result.total_cents).toBe(0)
    })

    it('zero quantity item', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 0 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(0)
      expect(result.line_items[0]!.paid_units).toBe(0)
      expect(result.line_items[0]!.line_charge_cents).toBe(0)
    })

    it('unknown service (no rule) defaults to 0 max and 0 price', () => {
      const result = computeLineItems(
        [{ service_id: 'unknown-svc', quantity: 2 }],
        empty(),  // no rules
        empty(),
        empty(),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(0)
      expect(result.line_items[0]!.paid_units).toBe(2)
      expect(result.line_items[0]!.unit_price_cents).toBe(0)
      expect(result.line_items[0]!.line_charge_cents).toBe(0)
    })

    it('zero max_collections means everything is paid', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 0, extra_unit_price: 25 }]]),
        catMax([[CAT_BULK, 0]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.free_units).toBe(0)
      expect(result.line_items[0]!.paid_units).toBe(3)
      expect(result.line_items[0]!.line_charge_cents).toBe(3 * 2500)
    })

    it('prior FY usage reduces remaining allocations', () => {
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        usage([[SVC_GENERAL, 3]]),  // 3 already used for this service
        usage([[CAT_BULK, 3]]),     // 3 already used for this category
      )
      // remaining: min(3, 5-3, 5-3) = min(3, 2, 2) = 2
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(1)
    })

    it('category_code defaults to empty string for unmapped service', () => {
      const result = computeLineItems(
        [{ service_id: 'unmapped', quantity: 1 }],
        rules([['unmapped', { max_collections: 0, extra_unit_price: 10 }]]),
        empty(),
        empty(), // no service-to-category mapping
        empty(),
        empty(),
      )
      expect(result.line_items[0]!.category_code).toBe('')
    })
  })

  // ── Allocation overrides ──────────────────────────────

  describe('allocation overrides', () => {
    const OVERRIDE_TIME = '2026-03-15T10:00:00Z'

    it('override resets category remaining to set_remaining', () => {
      // Category max is 3, all 3 used. Override sets remaining to 2.
      const overrides: AllocationOverride[] = [
        { category_code: CAT_BULK, set_remaining: 2, reason: 'Admin reset', created_at: OVERRIDE_TIME },
      ]

      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 2 }],
        rules([[SVC_GENERAL, { max_collections: 10, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 3]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(), // no service usage
        usage([[CAT_BULK, 3]]), // all 3 category used (pre-override)
        overrides,
        empty(), // no post-override usage
      )

      // Override gives 2 free, ignoring the exhausted category budget
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(0)
      expect(result.line_items[0]!.was_overridden).toBe(true)
      expect(result.override_applied).toBe(true)
      expect(result.override_reason).toBe('Admin reset')
      expect(result.total_cents).toBe(0)
    })

    it('post-override usage reduces the overridden budget', () => {
      const overrides: AllocationOverride[] = [
        { category_code: CAT_BULK, set_remaining: 3, reason: 'Compassionate reset', created_at: OVERRIDE_TIME },
      ]

      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 10, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        usage([[CAT_BULK, 6]]), // total usage (pre + post)
        overrides,
        usage([[CAT_BULK, 1]]), // 1 booking made after override
      )

      // Override set_remaining = 3, post-override used = 1, so 2 free remaining
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(1)
      expect(result.line_items[0]!.was_overridden).toBe(true)
      expect(result.line_items[0]!.line_charge_cents).toBe(5000)
    })

    it('override does not affect service-level limits', () => {
      const overrides: AllocationOverride[] = [
        { category_code: CAT_BULK, set_remaining: 10, reason: 'Big reset', created_at: OVERRIDE_TIME },
      ]

      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 5 }],
        rules([[SVC_GENERAL, { max_collections: 2, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 2]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
        overrides,
        empty(),
      )

      // Override gives 10 category remaining, but service max is 2
      // Dual-limit: min(5, 10, 2) = 2 free
      expect(result.line_items[0]!.free_units).toBe(2)
      expect(result.line_items[0]!.paid_units).toBe(3)
      expect(result.line_items[0]!.was_overridden).toBe(true)
    })

    it('no override = standard calculation (regression)', () => {
      // Same inputs, no overrides — should match standard behaviour
      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 5, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 5]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        usage([[SVC_GENERAL, 2]]),
        usage([[CAT_BULK, 2]]),
        undefined, // no overrides
        undefined, // no post-override usage
      )

      // Standard: min(3, 5-2, 5-2) = min(3, 3, 3) = 3 free
      expect(result.line_items[0]!.free_units).toBe(3)
      expect(result.line_items[0]!.paid_units).toBe(0)
      expect(result.line_items[0]!.was_overridden).toBe(false)
      expect(result.override_applied).toBe(false)
      expect(result.override_reason).toBeUndefined()
      expect(result.total_cents).toBe(0)
    })

    it('override on one category does not affect another category', () => {
      const overrides: AllocationOverride[] = [
        { category_code: CAT_BULK, set_remaining: 5, reason: 'Bulk reset', created_at: OVERRIDE_TIME },
      ]

      const result = computeLineItems(
        [
          { service_id: SVC_GENERAL, quantity: 3 },
          { service_id: SVC_MATTRESS, quantity: 3 },
        ],
        rules([
          [SVC_GENERAL, { max_collections: 10, extra_unit_price: 50 }],
          [SVC_MATTRESS, { max_collections: 10, extra_unit_price: 60 }],
        ]),
        catMax([
          [CAT_BULK, 2],
          [CAT_ANC, 1],
        ]),
        svcCat([
          [SVC_GENERAL, CAT_BULK],
          [SVC_MATTRESS, CAT_ANC],
        ]),
        empty(),
        empty(),
        overrides,
        empty(),
      )

      // Bulk: override gives 5 remaining → 3 free
      expect(result.line_items[0]!.free_units).toBe(3)
      expect(result.line_items[0]!.was_overridden).toBe(true)
      // Ancillary: no override, standard max=1 → 1 free, 2 paid
      expect(result.line_items[1]!.free_units).toBe(1)
      expect(result.line_items[1]!.paid_units).toBe(2)
      expect(result.line_items[1]!.was_overridden).toBe(false)
    })

    it('multiple overrides for same category uses most recent', () => {
      const overrides: AllocationOverride[] = [
        { category_code: CAT_BULK, set_remaining: 1, reason: 'First reset', created_at: '2026-03-10T10:00:00Z' },
        { category_code: CAT_BULK, set_remaining: 4, reason: 'Second reset', created_at: '2026-03-15T10:00:00Z' },
      ]

      const result = computeLineItems(
        [{ service_id: SVC_GENERAL, quantity: 3 }],
        rules([[SVC_GENERAL, { max_collections: 10, extra_unit_price: 50 }]]),
        catMax([[CAT_BULK, 2]]),
        svcCat([[SVC_GENERAL, CAT_BULK]]),
        empty(),
        empty(),
        overrides,
        empty(),
      )

      // Most recent override has set_remaining=4 → 3 free
      expect(result.line_items[0]!.free_units).toBe(3)
      expect(result.line_items[0]!.paid_units).toBe(0)
    })
  })
})
