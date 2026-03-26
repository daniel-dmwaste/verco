'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { BookingStepper } from '@/components/booking/booking-stepper'
import { encodeItems } from '@/lib/booking/search-params'
import type { BookingItem } from '@/lib/booking/schemas'

interface ServiceRuleRow {
  id: string
  service_type_id: string
  max_collections: number
  extra_unit_price: number
  collection_area_id: string
  service_type: {
    id: string
    name: string
    category_id: string
    category: {
      id: string
      name: string
      capacity_bucket: string
    }
  }
}

export function ServicesForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const propertyId = searchParams.get('property_id') ?? ''
  const collectionAreaId = searchParams.get('collection_area_id') ?? ''
  const address = searchParams.get('address') ?? ''

  const supabase = createClient()

  // Quantities map: service_type_id → quantity
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map())

  // Fetch service rules for this collection area
  const { data: serviceRules } = useQuery({
    queryKey: ['service-rules', collectionAreaId],
    enabled: !!collectionAreaId,
    queryFn: async () => {
      const { data } = await supabase
        .from('service_rules')
        .select(
          '*, service_type!inner(id, name, category_id, category!inner(id, name, capacity_bucket))'
        )
        .eq('collection_area_id', collectionAreaId)

      return (data ?? []) as unknown as ServiceRuleRow[]
    },
  })

  // Fetch current FY usage for this property
  const { data: fyUsage } = useQuery({
    queryKey: ['fy-usage', propertyId],
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
          'no_services, service_type_id, booking!inner(property_id, fy_id, status)'
        )
        .eq('booking.property_id', propertyId)
        .eq('booking.fy_id', fy.id)
        .not('booking.status', 'in', '("Cancelled","Pending Payment")')

      const usage = new Map<string, number>()
      if (items) {
        for (const item of items) {
          usage.set(
            item.service_type_id,
            (usage.get(item.service_type_id) ?? 0) + item.no_services
          )
        }
      }
      return usage
    },
  })

  // Group services by capacity bucket
  const grouped = useMemo(() => {
    if (!serviceRules) return { bulk: [], anc: [] }

    const bulk: ServiceRuleRow[] = []
    const anc: ServiceRuleRow[] = []

    for (const rule of serviceRules) {
      const bucket = rule.service_type.category.capacity_bucket
      if (bucket === 'bulk') bulk.push(rule)
      else if (bucket === 'anc') anc.push(rule)
    }

    return { bulk, anc }
  }, [serviceRules])

  // Calculate remaining allocation per bucket
  function getBucketRemaining(rules: ServiceRuleRow[]): {
    totalMax: number
    totalUsed: number
    remaining: number
  } {
    let totalMax = 0
    let totalUsed = 0
    for (const rule of rules) {
      totalMax += rule.max_collections
      totalUsed += fyUsage?.get(rule.service_type_id) ?? 0
    }
    return {
      totalMax,
      totalUsed: Math.min(totalUsed, totalMax),
      remaining: Math.max(0, totalMax - totalUsed),
    }
  }

  // Build pricing items
  const pricingItems: BookingItem[] = useMemo(() => {
    if (!serviceRules || !fyUsage) return []

    return serviceRules
      .filter((rule) => (quantities.get(rule.service_type_id) ?? 0) > 0)
      .map((rule) => {
        const qty = quantities.get(rule.service_type_id) ?? 0
        const used = fyUsage.get(rule.service_type_id) ?? 0
        const remainingFree = Math.max(0, rule.max_collections - used)
        const freeUnits = Math.min(qty, remainingFree)
        const paidUnits = qty - freeUnits
        const unitPriceCents = Math.round(rule.extra_unit_price * 100)

        return {
          service_type_id: rule.service_type_id,
          service_name: rule.service_type.name,
          category_name: rule.service_type.category.name,
          capacity_bucket: rule.service_type.category.capacity_bucket as
            | 'bulk'
            | 'anc'
            | 'id',
          no_services: qty,
          free_units: freeUnits,
          paid_units: paidUnits,
          unit_price_cents: unitPriceCents,
          line_charge_cents: paidUnits * unitPriceCents,
        }
      })
  }, [serviceRules, fyUsage, quantities])

  const totalChargeCents = pricingItems.reduce(
    (sum, item) => sum + item.line_charge_cents,
    0
  )

  const totalItems = pricingItems.reduce(
    (sum, item) => sum + item.no_services,
    0
  )

  function updateQty(serviceTypeId: string, delta: number) {
    setQuantities((prev) => {
      const next = new Map(prev)
      const current = next.get(serviceTypeId) ?? 0
      const updated = Math.max(0, current + delta)
      if (updated === 0) {
        next.delete(serviceTypeId)
      } else {
        next.set(serviceTypeId, updated)
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
    })
    router.push(`/book/date?${params.toString()}`)
  }

  function handleBack() {
    router.push('/book')
  }

  function renderServiceSection(
    title: string,
    rules: ServiceRuleRow[],
    accentColor: 'green' | 'navy'
  ) {
    const { totalMax, remaining } = getBucketRemaining(rules)
    const badgeClass =
      accentColor === 'green'
        ? 'bg-[#E8FDF0] text-[#006A38]'
        : 'bg-[#E8EEF2] text-[#293F52]'
    const accentBg =
      accentColor === 'green' ? 'bg-[#00B864]' : 'bg-[#293F52]'

    // Calculate extra cost rows for this section
    const extraRows = pricingItems.filter(
      (item) =>
        item.paid_units > 0 &&
        rules.some((r) => r.service_type_id === item.service_type_id)
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
            {remaining} of {totalMax} remaining
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {rules.map((rule) => {
            const qty = quantities.get(rule.service_type_id) ?? 0
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
                      {rule.service_type.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      {rule.service_type.category.name}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-full bg-gray-50 px-2.5 py-1">
                  <button
                    type="button"
                    onClick={() => updateQty(rule.service_type_id, -1)}
                    className="flex size-7 items-center justify-center rounded-full text-lg font-semibold text-gray-700"
                  >
                    &minus;
                  </button>
                  <span className="min-w-[16px] text-center text-[15px] font-semibold text-[#293F52]">
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQty(rule.service_type_id, 1)}
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
              key={`extra-${item.service_type_id}`}
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
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <div className="flex h-14 items-center gap-3 bg-white px-5 shadow-sm">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#00E47C] font-[family-name:var(--font-heading)] text-lg font-bold text-[#293F52]">
          V
        </div>
        <span className="font-[family-name:var(--font-heading)] text-[17px] font-bold text-[#293F52]">
          VERCO
        </span>
      </div>

      <BookingStepper currentStep={2} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 pb-24 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-bold leading-tight text-[#293F52]">
            Select Services
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            Choose items for collection. Combine multiple service types.
          </p>
        </div>

        {grouped.bulk.length > 0 &&
          renderServiceSection('Bulk Collection', grouped.bulk, 'green')}

        {grouped.anc.length > 0 &&
          renderServiceSection('Ancillary Collection', grouped.anc, 'navy')}

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
      <div className="sticky bottom-0 flex gap-2.5 border-t border-gray-100 bg-white px-8 pb-5 pt-3">
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
