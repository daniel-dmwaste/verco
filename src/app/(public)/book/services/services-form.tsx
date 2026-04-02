'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { BookingStepper } from '@/components/booking/booking-stepper'
import { encodeItems, decodeItems } from '@/lib/booking/search-params'
import type { BookingItem } from '@/lib/booking/schemas'

interface ServiceRuleRow {
  id: string
  service_id: string
  max_collections: number
  extra_unit_price: number
  collection_area_id: string
  service: {
    id: string
    name: string
    category_id: string
    category: {
      id: string
      name: string
      code: string
    }
  }
}

export function ServicesForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const propertyId = searchParams.get('property_id') ?? ''
  const collectionAreaId = searchParams.get('collection_area_id') ?? ''
  const address = searchParams.get('address') ?? ''
  const onBehalf = searchParams.get('on_behalf') === 'true'

  const supabase = createClient()

  // Prefill from ?items= param (edit flow) or start empty
  const initialItems = searchParams.get('items') ?? ''
  const [quantities, setQuantities] = useState<Map<string, number>>(() => decodeItems(initialItems))

  // Fetch service rules for this collection area
  const { data: serviceRules } = useQuery({
    queryKey: ['service-rules', collectionAreaId],
    enabled: !!collectionAreaId,
    queryFn: async () => {
      const { data } = await supabase
        .from('service_rules')
        .select(
          '*, service!inner(id, name, category_id, category!inner(id, name, code))'
        )
        .eq('collection_area_id', collectionAreaId)

      return (data ?? []) as unknown as ServiceRuleRow[]
    },
  })

  // Fetch allocation_rules at category level (Bulk max, Ancillary max)
  const { data: categoryAllocations } = useQuery({
    queryKey: ['category-allocations', collectionAreaId],
    enabled: !!collectionAreaId,
    queryFn: async () => {
      const { data } = await supabase
        .from('allocation_rules')
        .select('max_collections, category!inner(code)')
        .eq('collection_area_id', collectionAreaId)

      const result = new Map<string, number>()
      if (data) {
        for (const rule of data) {
          const cat = rule.category as unknown as { code: string }
          result.set(cat.code, rule.max_collections)
        }
      }
      return result
    },
  })

  // Fetch existing FY usage grouped by category code
  const { data: fyUsageByCategory } = useQuery({
    queryKey: ['fy-usage-by-category', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data: fy } = await supabase
        .from('financial_year')
        .select('id')
        .eq('is_current', true)
        .single()

      if (!fy) return new Map<string, number>()

      const { data: items } = await supabase
        .from('booking_item')
        .select(
          'no_services, service!inner(category!inner(code)), booking!inner(property_id, fy_id, status)'
        )
        .eq('booking.property_id', propertyId)
        .eq('booking.fy_id', fy.id)
        .not('booking.status', 'in', '("Cancelled","Pending Payment")')

      const usage = new Map<string, number>()
      if (items) {
        for (const item of items) {
          const svc = item.service as unknown as { category: { code: string } }
          const code = svc.category.code
          usage.set(code, (usage.get(code) ?? 0) + item.no_services)
        }
      }
      return usage
    },
  })

  // Also fetch per-service FY usage (for individual service pricing calc)
  const { data: fyUsageByService } = useQuery({
    queryKey: ['fy-usage-by-service', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data: fy } = await supabase
        .from('financial_year')
        .select('id')
        .eq('is_current', true)
        .single()

      if (!fy) return new Map<string, number>()

      const { data: items } = await supabase
        .from('booking_item')
        .select(
          'no_services, service_id, booking!inner(property_id, fy_id, status)'
        )
        .eq('booking.property_id', propertyId)
        .eq('booking.fy_id', fy.id)
        .not('booking.status', 'in', '("Cancelled","Pending Payment")')

      const usage = new Map<string, number>()
      if (items) {
        for (const item of items) {
          usage.set(
            item.service_id,
            (usage.get(item.service_id) ?? 0) + item.no_services
          )
        }
      }
      return usage
    },
  })

  // Group services by category code
  const grouped = useMemo(() => {
    if (!serviceRules) return { bulk: [], anc: [] }

    const bulk: ServiceRuleRow[] = []
    const anc: ServiceRuleRow[] = []

    for (const rule of serviceRules) {
      const code = rule.service.category.code
      if (code === 'bulk') bulk.push(rule)
      else if (code === 'anc') anc.push(rule)
    }

    return { bulk, anc }
  }, [serviceRules])

  // Build pricing items AND category budget consumption in a single pass.
  // The categoryFreeUsed map tracks how many FREE units each category bucket
  // has consumed — this is used for both pricing AND badge display.
  const { pricingItems, categoryFreeUsed } = useMemo(() => {
    if (!serviceRules || !fyUsageByService || !categoryAllocations || !fyUsageByCategory) {
      return { pricingItems: [] as BookingItem[], categoryFreeUsed: new Map<string, number>() }
    }

    const formUsed = new Map<string, number>()

    const activeRules = serviceRules.filter(
      (rule) => (quantities.get(rule.service_id) ?? 0) > 0
    )

    const items = activeRules.map((rule) => {
      const qty = quantities.get(rule.service_id) ?? 0
      const catCode = rule.service.category.code

      // Service-level remaining
      const serviceUsed = fyUsageByService.get(rule.service_id) ?? 0
      const serviceRemaining = Math.max(0, rule.max_collections - serviceUsed)

      // Category-level remaining (minus free units already consumed by earlier items in this form)
      const catMax = categoryAllocations.get(catCode) ?? 0
      const catFyUsed = fyUsageByCategory.get(catCode) ?? 0
      const catAlreadyConsumedByForm = formUsed.get(catCode) ?? 0
      const categoryRemaining = Math.max(0, catMax - catFyUsed - catAlreadyConsumedByForm)

      // Dual-limit: free units = MIN(qty, category_remaining, service_remaining)
      const freeUnits = Math.min(qty, categoryRemaining, serviceRemaining)
      const paidUnits = qty - freeUnits

      // Only free units consume category budget — paid units do not
      formUsed.set(catCode, catAlreadyConsumedByForm + freeUnits)

      const unitPriceCents = Math.round(rule.extra_unit_price * 100)

      return {
        service_id: rule.service_id,
        service_name: rule.service.name,
        category_name: rule.service.category.name,
        code: catCode as 'bulk' | 'anc' | 'id',
        no_services: qty,
        free_units: freeUnits,
        paid_units: paidUnits,
        unit_price_cents: unitPriceCents,
        line_charge_cents: paidUnits * unitPriceCents,
      }
    })

    return { pricingItems: items, categoryFreeUsed: formUsed }
  }, [serviceRules, fyUsageByService, fyUsageByCategory, categoryAllocations, quantities])

  // Badge remaining: max - fyUsed - freeUnitsConsumedByForm
  function getLiveRemaining(categoryCode: string): number {
    const max = categoryAllocations?.get(categoryCode) ?? 0
    const fyUsed = fyUsageByCategory?.get(categoryCode) ?? 0
    const formFreeUsed = categoryFreeUsed.get(categoryCode) ?? 0
    return Math.max(0, max - fyUsed - formFreeUsed)
  }

  const totalChargeCents = pricingItems.reduce(
    (sum, item) => sum + item.line_charge_cents,
    0
  )

  const totalItems = pricingItems.reduce(
    (sum, item) => sum + item.no_services,
    0
  )

  function updateQty(serviceId: string, delta: number) {
    setQuantities((prev) => {
      const next = new Map(prev)
      const current = next.get(serviceId) ?? 0
      const updated = Math.max(0, current + delta)
      if (updated === 0) {
        next.delete(serviceId)
      } else {
        next.set(serviceId, updated)
      }
      return next
    })
  }

  function handleContinue() {
    if (totalItems === 0) return
    const params = new URLSearchParams({
      property_id: propertyId,
      collection_area_id: collectionAreaId,
      address,
      items: encodeItems(pricingItems),
      total_cents: totalChargeCents.toString(),
      ...(onBehalf ? { on_behalf: 'true' } : {}),
    })
    router.push(`/book/date?${params.toString()}`)
  }

  function handleBack() {
    const params = new URLSearchParams({
      address,
      ...(initialItems ? { items: initialItems } : {}),
      ...(onBehalf ? { on_behalf: 'true' } : {}),
    })
    router.push(`/book?${params.toString()}`)
  }

  function renderServiceSection(
    title: string,
    categoryCode: string,
    rules: ServiceRuleRow[]
  ) {
    const max = categoryAllocations?.get(categoryCode) ?? 0
    const remaining = getLiveRemaining(categoryCode)
    const badgeClass =
      remaining > 0
        ? 'bg-[#E8FDF0] text-[#006A38]'
        : 'bg-[#FFF0F0] text-[#E53E3E]'
    const accentBg =
      categoryCode === 'bulk' ? 'bg-[#00B864]' : 'bg-[#293F52]'

    // Extra cost rows for this section
    const extraRows = pricingItems.filter(
      (item) =>
        item.paid_units > 0 &&
        rules.some((r) => r.service_id === item.service_id)
    )

    return (
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]">
            {title}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${badgeClass}`}
          >
            {remaining} of {max} remaining
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {rules.map((rule) => {
            const qty = quantities.get(rule.service_id) ?? 0
            return (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-xl border-[1.5px] border-gray-100 bg-white px-4 py-3.5 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-1 rounded-sm ${accentBg}`}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold text-gray-900">
                      {rule.service.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      {rule.service.category.name}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-full bg-gray-50 px-2.5 py-1">
                  <button
                    type="button"
                    onClick={() => updateQty(rule.service_id, -1)}
                    className="flex size-7 items-center justify-center rounded-full text-lg font-semibold text-gray-700"
                  >
                    &minus;
                  </button>
                  <span className="min-w-[16px] text-center text-[15px] font-semibold text-[#293F52]">
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQty(rule.service_id, 1)}
                    className="flex size-7 items-center justify-center rounded-full bg-[#293F52] text-lg font-semibold text-white"
                  >
                    +
                  </button>
                </div>
              </div>
            )
          })}

          {/* Extra cost rows */}
          {extraRows.map((item) => (
            <div
              key={`extra-${item.service_id}`}
              className="flex items-center justify-between rounded-lg border border-[#00B864] bg-[#F0FBF5] px-3.5 py-2.5 text-[13px]"
            >
              <div className="flex items-center gap-2 text-gray-700">
                <span className="font-semibold text-[#00B864]">$</span>
                {item.paid_units} extra {item.service_name.toLowerCase()} @
                ${(item.unit_price_cents / 100).toFixed(2)} each
              </div>
              <span className="font-semibold text-[#293F52]">
                ${(item.line_charge_cents / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <BookingStepper currentStep={2} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-24 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-bold leading-tight text-[#293F52]">
            Select Services
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            Choose items for collection. Combine multiple service types.
          </p>
        </div>

        {grouped.bulk.length > 0 &&
          renderServiceSection('Bulk Collection', 'bulk', grouped.bulk)}

        {grouped.anc.length > 0 &&
          renderServiceSection('Ancillary Collection', 'anc', grouped.anc)}

        {/* Total bar */}
        {totalChargeCents > 0 && (
          <div className="flex items-center justify-between rounded-[10px] bg-[#E8EEF2] px-4 py-3.5">
            <span className="text-sm font-semibold text-[#293F52]">
              Total Extra Services Cost
            </span>
            <span className="font-[family-name:var(--font-heading)] text-lg font-bold text-[#293F52]">
              ${(totalChargeCents / 100).toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="sticky bottom-0 flex gap-2.5 pb-5 pt-3">
        <button
          type="button"
          onClick={handleBack}
          className="flex h-[52px] flex-1 items-center justify-center rounded-xl border-[1.5px] border-gray-100 bg-white font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52] transition-opacity hover:opacity-90"
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={totalItems === 0}
          className="flex h-[52px] flex-1 items-center justify-center rounded-xl bg-[#293F52] font-[family-name:var(--font-heading)] text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Next Step &rarr;
        </button>
      </div>
    </div>
  )
}
