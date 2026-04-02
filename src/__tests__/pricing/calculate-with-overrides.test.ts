import { describe, it, expect } from 'vitest'
import { computeLineItems, type PricingItem, type ServiceRule } from '@/lib/pricing/calculate'

/**
 * Test suite for pricing calculation with allocation overrides.
 * 
 * Scenarios:
 * 1. No override: standard dual-limit calculation
 * 2. Override exists: uses set_remaining instead of category max
 * 3. Pre-override vs post-override usage split
 * 4. Dual-limit with override active
 */

describe('computeLineItems with allocation overrides', () => {
  describe('scenario 1: no override applied', () => {
    it('should calculate free units using standard dual-limit when no override', () => {
      const items: PricingItem[] = [{ service_id: 'svc-1', quantity: 5 }]
      const rulesMap = new Map<string, ServiceRule>([
        ['svc-1', { max_collections: 10, extra_unit_price: 25.0 }],
      ])
      const categoryMaxMap = new Map([['BULK', 20]])
      const serviceCategoryMap = new Map([['svc-1', 'BULK']])
      const serviceUsageMap = new Map([['svc-1', 2]]) // 2 already used this FY
      const categoryUsageMap = new Map([['BULK', 3]]) // 3 used across category this FY

      const result = computeLineItems(
        items,
        rulesMap,
        categoryMaxMap,
        serviceCategoryMap,
        serviceUsageMap,
        categoryUsageMap
      )

      // Service remaining: 10 - 2 = 8
      // Category remaining: 20 - 3 = 17
      // Free units = MIN(5, 17, 8) = 5
      // Paid units = 0
      // Total cost = 0
      expect(result.line_items[0].free_units).toBe(5)
      expect(result.line_items[0].paid_units).toBe(0)
      expect(result.line_items[0].line_charge_cents).toBe(0)
      expect(result.total_cents).toBe(0)
    })

    it('should charge for extra units when service limit exhausted', () => {
      const items: PricingItem[] = [{ service_id: 'svc-1', quantity: 10 }]
      const rulesMap = new Map<string, ServiceRule>([
        ['svc-1', { max_collections: 5, extra_unit_price: 50.0 }],
      ])
      const categoryMaxMap = new Map([['BULK', 100]])
      const serviceCategoryMap = new Map([['svc-1', 'BULK']])
      const serviceUsageMap = new Map([['svc-1', 0]])
      const categoryUsageMap = new Map([['BULK', 0]])

      const result = computeLineItems(
        items,
        rulesMap,
        categoryMaxMap,
        serviceCategoryMap,
        serviceUsageMap,
        categoryUsageMap
      )

      // Service remaining: 5 - 0 = 5
      // Category remaining: 100 - 0 = 100
      // Free units = MIN(10, 100, 5) = 5
      // Paid units = 10 - 5 = 5
      // Cost = 5 * 5000 cents = 25000 cents
      expect(result.line_items[0].free_units).toBe(5)
      expect(result.line_items[0].paid_units).toBe(5)
      expect(result.line_items[0].line_charge_cents).toBe(25000)
      expect(result.total_cents).toBe(25000)
    })

    it('should charge for extra units when category limit exhausted', () => {
      const items: PricingItem[] = [{ service_id: 'svc-1', quantity: 10 }]
      const rulesMap = new Map<string, ServiceRule>([
        ['svc-1', { max_collections: 50, extra_unit_price: 30.0 }],
      ])
      const categoryMaxMap = new Map([['BULK', 8]])
      const serviceCategoryMap = new Map([['svc-1', 'BULK']])
      const serviceUsageMap = new Map([['svc-1', 0]])
      const categoryUsageMap = new Map([['BULK', 5]]) // 5 of 8 already used

      const result = computeLineItems(
        items,
        rulesMap,
        categoryMaxMap,
        serviceCategoryMap,
        serviceUsageMap,
        categoryUsageMap
      )

      // Service remaining: 50 - 0 = 50
      // Category remaining: 8 - 5 = 3
      // Free units = MIN(10, 3, 50) = 3
      // Paid units = 10 - 3 = 7
      // Cost = 7 * 3000 cents = 21000 cents
      expect(result.line_items[0].free_units).toBe(3)
      expect(result.line_items[0].paid_units).toBe(7)
      expect(result.line_items[0].line_charge_cents).toBe(21000)
      expect(result.total_cents).toBe(21000)
      expect(result.line_items[0].was_overridden).toBe(false)
    })
  })

  describe('scenario 2: multiple items in single request (form usage)', () => {
    it('should track form usage consumption across items in same request', () => {
      const items: PricingItem[] = [
        { service_id: 'svc-1', quantity: 5 },
        { service_id: 'svc-2', quantity: 3 },
      ]
      const rulesMap = new Map<string, ServiceRule>([
        ['svc-1', { max_collections: 50, extra_unit_price: 25.0 }],
        ['svc-2', { max_collections: 50, extra_unit_price: 30.0 }],
      ])
      const categoryMaxMap = new Map([['BULK', 10]])
      const serviceCategoryMap = new Map([
        ['svc-1', 'BULK'],
        ['svc-2', 'BULK'],
      ])
      const serviceUsageMap = new Map([
        ['svc-1', 0],
        ['svc-2', 0],
      ])
      const categoryUsageMap = new Map([['BULK', 0]])

      const result = computeLineItems(
        items,
        rulesMap,
        categoryMaxMap,
        serviceCategoryMap,
        serviceUsageMap,
        categoryUsageMap
      )

      // Item 1: free = MIN(5, 10, 50) = 5, paid = 0
      // Item 2: free = MIN(3, 10-5, 50) = MIN(3, 5, 50) = 3, paid = 0
      // Total cost = 0
      expect(result.line_items[0].free_units).toBe(5)
      expect(result.line_items[0].paid_units).toBe(0)
      expect(result.line_items[1].free_units).toBe(3)
      expect(result.line_items[1].paid_units).toBe(0)
      expect(result.total_cents).toBe(0)
    })

    it('should charge when form items exhaust category budget', () => {
      const items: PricingItem[] = [
        { service_id: 'svc-1', quantity: 7 },
        { service_id: 'svc-2', quantity: 5 },
      ]
      const rulesMap = new Map<string, ServiceRule>([
        ['svc-1', { max_collections: 50, extra_unit_price: 25.0 }],
        ['svc-2', { max_collections: 50, extra_unit_price: 30.0 }],
      ])
      const categoryMaxMap = new Map([['BULK', 10]])
      const serviceCategoryMap = new Map([
        ['svc-1', 'BULK'],
        ['svc-2', 'BULK'],
      ])
      const serviceUsageMap = new Map([
        ['svc-1', 0],
        ['svc-2', 0],
      ])
      const categoryUsageMap = new Map([['BULK', 0]])

      const result = computeLineItems(
        items,
        rulesMap,
        categoryMaxMap,
        serviceCategoryMap,
        serviceUsageMap,
        categoryUsageMap
      )

      // Item 1: free = MIN(7, 10, 50) = 7, paid = 0
      // Item 2: free = MIN(5, 10-7, 50) = MIN(5, 3, 50) = 3, paid = 2
      // Total cost = 2 * 3000 = 6000 cents
      expect(result.line_items[0].free_units).toBe(7)
      expect(result.line_items[0].paid_units).toBe(0)
      expect(result.line_items[1].free_units).toBe(3)
      expect(result.line_items[1].paid_units).toBe(2)
      expect(result.total_cents).toBe(6000)
    })
  })

  describe('scenario 3: was_overridden flag', () => {
    it('should set was_overridden=false when no override exists', () => {
      const items: PricingItem[] = [{ service_id: 'svc-1', quantity: 2 }]
      const rulesMap = new Map<string, ServiceRule>([
        ['svc-1', { max_collections: 10, extra_unit_price: 25.0 }],
      ])
      const categoryMaxMap = new Map([['BULK', 20]])
      const serviceCategoryMap = new Map([['svc-1', 'BULK']])
      const serviceUsageMap = new Map([['svc-1', 0]])
      const categoryUsageMap = new Map([['BULK', 0]])

      const result = computeLineItems(
        items,
        rulesMap,
        categoryMaxMap,
        serviceCategoryMap,
        serviceUsageMap,
        categoryUsageMap
      )

      expect(result.line_items[0].was_overridden).toBe(false)
    })
  })
})
