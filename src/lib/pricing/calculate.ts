/**
 * Node-compatible pricing engine — extracted from supabase/functions/_shared/pricing.ts.
 * Keep in sync with the Edge Function version.
 *
 * This module contains the pure calculation logic (no Supabase dependency)
 * so it can be unit tested with Vitest and reused in client-side previews.
 */

export interface PricingItem {
  service_id: string
  quantity: number
}

export interface PricedLineItem {
  service_id: string
  quantity: number
  free_units: number
  paid_units: number
  unit_price_cents: number
  line_charge_cents: number
  is_extra: boolean
  category_code: string
  was_overridden: boolean
}

export interface PriceCalculationResult {
  line_items: PricedLineItem[]
  total_cents: number
  override_applied: boolean
  override_reason?: string
}

export interface AllocationOverride {
  category_code: string
  set_remaining: number
  reason: string
  created_at: string
}

export interface ServiceRule {
  max_collections: number
  extra_unit_price: number
}

/**
 * Pure pricing calculation implementing the dual-limit free unit model.
 *
 * A unit becomes paid (extra) when EITHER limit is exhausted:
 *   category_remaining = categoryMaxMap[cat] - categoryUsageMap[cat] - categoryFormUsed[cat]
 *   service_remaining  = serviceRule.max_collections - serviceUsageMap[svc]
 *   free_units         = MIN(requested_qty, category_remaining, service_remaining)
 *
 * Only free_units consume category budget — paid units do not reduce the remaining count.
 *
 * When overrides are provided, the category_remaining calculation changes for
 * overridden categories:
 *   category_remaining = override.set_remaining - postOverrideUsage - categoryFormUsed
 * Post-override usage = bookings created on or after override.created_at (passed via
 * postOverrideCategoryUsageMap).
 */
export function computeLineItems(
  items: PricingItem[],
  rulesMap: Map<string, ServiceRule>,
  categoryMaxMap: Map<string, number>,
  serviceCategoryMap: Map<string, string>,
  serviceUsageMap: Map<string, number>,
  categoryUsageMap: Map<string, number>,
  overrides?: AllocationOverride[],
  postOverrideCategoryUsageMap?: Map<string, number>,
): PriceCalculationResult {
  // Build overrides map: most recent override per category code
  const overridesByCode = new Map<string, AllocationOverride>()
  if (overrides) {
    for (const override of overrides) {
      const existing = overridesByCode.get(override.category_code)
      if (!existing || new Date(override.created_at) > new Date(existing.created_at)) {
        overridesByCode.set(override.category_code, override)
      }
    }
  }

  const categoryFormUsed = new Map<string, number>()

  const line_items: PricedLineItem[] = items.map((item) => {
    const rule = rulesMap.get(item.service_id)
    const catCode = serviceCategoryMap.get(item.service_id) ?? ''

    // Service-level remaining (unchanged by overrides)
    const serviceUsed = serviceUsageMap.get(item.service_id) ?? 0
    const serviceMax = rule?.max_collections ?? 0
    const serviceRemaining = Math.max(0, serviceMax - serviceUsed)

    // Category-level remaining (with override support)
    const override = overridesByCode.get(catCode)
    const catAlreadyConsumedByForm = categoryFormUsed.get(catCode) ?? 0
    let categoryRemaining: number

    if (override) {
      // Override: use set_remaining minus only post-override usage
      const postOverrideUsed = postOverrideCategoryUsageMap?.get(catCode) ?? 0
      categoryRemaining = Math.max(0, override.set_remaining - postOverrideUsed - catAlreadyConsumedByForm)
    } else {
      // Standard: category max minus total FY usage
      const catMax = categoryMaxMap.get(catCode) ?? 0
      const catFyUsed = categoryUsageMap.get(catCode) ?? 0
      categoryRemaining = Math.max(0, catMax - catFyUsed - catAlreadyConsumedByForm)
    }

    // Dual-limit: free_units = MIN(quantity, category_remaining, service_remaining)
    const freeUnits = Math.min(item.quantity, categoryRemaining, serviceRemaining)
    const paidUnits = item.quantity - freeUnits

    // Only free_units consume category budget
    categoryFormUsed.set(catCode, catAlreadyConsumedByForm + freeUnits)

    const unitPriceCents = Math.round((rule?.extra_unit_price ?? 0) * 100)
    const lineChargeCents = paidUnits * unitPriceCents

    return {
      service_id: item.service_id,
      quantity: item.quantity,
      free_units: freeUnits,
      paid_units: paidUnits,
      unit_price_cents: unitPriceCents,
      line_charge_cents: lineChargeCents,
      is_extra: paidUnits > 0,
      category_code: catCode,
      was_overridden: !!override,
    }
  })

  const total_cents = line_items.reduce((sum, l) => sum + l.line_charge_cents, 0)

  const overrideApplied = line_items.some((l) => l.was_overridden)
  const firstOverrideReason = overrideApplied
    ? [...overridesByCode.values()][0]?.reason
    : undefined

  return {
    line_items,
    total_cents,
    override_applied: overrideApplied,
    override_reason: firstOverrideReason,
  }
}
