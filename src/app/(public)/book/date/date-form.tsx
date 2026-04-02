'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { BookingStepper } from '@/components/booking/booking-stepper'
import { decodeItems } from '@/lib/booking/search-params'
import { cn } from '@/lib/utils'

export function DateForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const propertyId = searchParams.get('property_id') ?? ''
  const collectionAreaId = searchParams.get('collection_area_id') ?? ''
  const address = searchParams.get('address') ?? ''
  const itemsParam = searchParams.get('items') ?? ''
  const totalCents = searchParams.get('total_cents') ?? '0'
  const onBehalf = searchParams.get('on_behalf') === 'true'

  const selectedItems = decodeItems(itemsParam)

  const [selectedDateId, setSelectedDateId] = useState<string | null>(null)

  const supabase = createClient()

  // Determine which buckets are needed based on selected items
  const { data: neededBuckets } = useQuery({
    queryKey: ['needed-buckets', itemsParam],
    enabled: selectedItems.size > 0,
    queryFn: async () => {
      const serviceIds = Array.from(selectedItems.keys())
      const { data: services } = await supabase
        .from('service')
        .select('id, name, category!inner(code)')
        .in('id', serviceIds)

      const buckets = new Set<string>()
      const names: Array<{ name: string; qty: number }> = []

      if (services) {
        for (const st of services) {
          const category = st.category as unknown as { code: string }
          buckets.add(category.code)
          names.push({ name: st.name, qty: selectedItems.get(st.id) ?? 0 })
        }
      }

      return { buckets, serviceChips: names }
    },
  })

  // Fetch available collection dates
  const { data: dates } = useQuery({
    queryKey: ['collection-dates', collectionAreaId],
    enabled: !!collectionAreaId,
    queryFn: async () => {
      const { data } = await supabase
        .from('collection_date')
        .select('*')
        .eq('collection_area_id', collectionAreaId)
        .eq('is_open', true)
        .eq('for_mud', false)
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date', { ascending: true })

      return data ?? []
    },
  })

  // Filter dates based on needed capacity buckets
  const availableDates = (dates ?? []).filter((d) => {
    if (!neededBuckets) return true
    const { buckets } = neededBuckets
    if (buckets.has('bulk') && d.bulk_is_closed) return false
    if (buckets.has('anc') && d.anc_is_closed) return false
    return true
  })

  function handleContinue() {
    if (!selectedDateId) return
    const params = new URLSearchParams({
      property_id: propertyId,
      collection_area_id: collectionAreaId,
      address,
      items: itemsParam,
      total_cents: totalCents,
      collection_date_id: selectedDateId,
      ...(onBehalf ? { on_behalf: 'true' } : {}),
    })
    router.push(`/book/details?${params.toString()}`)
  }

  function handleBack() {
    const params = new URLSearchParams({
      property_id: propertyId,
      collection_area_id: collectionAreaId,
      address,
      ...(onBehalf ? { on_behalf: 'true' } : {}),
    })
    router.push(`/book/services?${params.toString()}`)
  }

  return (
    <div className="flex flex-col">
      <BookingStepper currentStep={3} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-24 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-bold leading-tight text-[#293F52]">
            Select Collection Date
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            Choose a date for your collection at{' '}
            {address.split(',')[0] ?? address}.
          </p>
        </div>

        {/* Selected services chips */}
        {neededBuckets && neededBuckets.serviceChips.length > 0 && (
          <div className="rounded-xl bg-white px-4 py-3.5 shadow-sm">
            <div className="mb-2 text-xs font-medium text-gray-500">
              Selected Services
            </div>
            <div className="flex flex-wrap gap-2">
              {neededBuckets.serviceChips.map((chip) => (
                <span
                  key={chip.name}
                  className="rounded-full border border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-700"
                >
                  {chip.name} &times; {chip.qty}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Date grid */}
        <div>
          <h2 className="mb-3 font-[family-name:var(--font-heading)] text-base font-semibold text-[#293F52]">
            Available Dates
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {availableDates.map((d) => {
              const isSelected = d.id === selectedDateId
              const spotsRemaining = Math.max(
                0,
                d.bulk_capacity_limit - d.bulk_units_booked
              )
              const isAlmostFull = spotsRemaining <= 10 && spotsRemaining > 0
              const dateObj = new Date(d.date + 'T00:00:00')

              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedDateId(d.id)}
                  className={cn(
                    'flex flex-col gap-1 rounded-xl border-[1.5px] px-2.5 py-3 shadow-sm transition-colors',
                    isSelected
                      ? 'border-[#00E47C] border-2 bg-[#293F52]'
                      : 'border-gray-100 bg-white hover:border-gray-200'
                  )}
                >
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      isSelected ? 'text-white' : 'text-[#293F52]'
                    )}
                  >
                    {format(dateObj, 'EEE d MMM')}
                  </span>
                  <span
                    className={cn(
                      'text-[11px]',
                      isSelected
                        ? 'text-green-200/85'
                        : 'text-gray-500'
                    )}
                  >
                    {spotsRemaining} spots
                  </span>
                  {isSelected && (
                    <span className="text-[10px] font-medium text-[#00E47C]">
                      Selected &#10003;
                    </span>
                  )}
                  {!isSelected && isAlmostFull && (
                    <span className="text-[10px] font-medium text-[#FF8C42]">
                      Almost full
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {availableDates.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">
              No available dates for this collection area.
            </p>
          )}
        </div>
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
          disabled={!selectedDateId}
          className="flex h-[52px] flex-1 items-center justify-center rounded-xl bg-[#293F52] font-[family-name:var(--font-heading)] text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Next Step &rarr;
        </button>
      </div>
    </div>
  )
}
