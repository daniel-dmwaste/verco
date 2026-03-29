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
}

export interface PriceCalculationResult {
  line_items: PricedLineItem[]
  total_cents: number
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
 */
export function computeLineItems(
  items: PricingItem[],
  rulesMap: Map<string, ServiceRule>,
  categoryMaxMap: Map<string, number>,
  serviceCategoryMap: Map<string, string>,
  serviceUsageMap: Map<string, number>,
  categoryUsageMap: Map<string, number>,
): PriceCalculationResult {
  const categoryFormUsed = new Map<string, number>()

  const line_items: PricedLineItem[] = items.map((item) => {
    const rule = rulesMap.get(item.service_id)
    const catCode = serviceCategoryMap.get(item.service_id) ?? ''

    // Service-level remaining
    const serviceUsed = serviceUsageMap.get(item.service_id) ?? 0
    const serviceMax = rule?.max_collections ?? 0
    const serviceRemaining = Math.max(0, serviceMax - serviceUsed)

    // Category-level remaining (minus what earlier items consumed)
    const catMax = categoryMaxMap.get(catCode) ?? 0
    const catFyUsed = categoryUsageMap.get(catCode) ?? 0
    const catAlreadyConsumedByForm = categoryFormUsed.get(catCode) ?? 0
    const categoryRemaining = Math.max(0, catMax - catFyUsed - catAlreadyConsumedByForm)

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
    }
  })

  const total_cents = line_items.reduce((sum, l) => sum + l.line_charge_cents, 0)

  return { line_items, total_cents }
}
