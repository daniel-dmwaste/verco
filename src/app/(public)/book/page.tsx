'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { BookingStepper } from '@/components/booking/booking-stepper'
import { AddressAutocomplete } from '@/components/booking/address-autocomplete'
import type { Database } from '@/lib/supabase/types'

type EligibleProperty = Database['public']['Tables']['eligible_properties']['Row']

export default function AddressPage() {
  const router = useRouter()
  const supabase = createClient()

  const [selectedProperty, setSelectedProperty] = useState<EligibleProperty | null>(null)
  const [notFound, setNotFound] = useState(false)

  // Fetch FY allocation info when a property is selected
  const { data: allocationData } = useQuery({
    queryKey: ['allocations', selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      if (!selectedProperty) return null

      // Get current FY
      const { data: fy } = await supabase
        .from('financial_year')
        .select('id, label')
        .eq('is_current', true)
        .single()

      if (!fy) return null

      // Get allocation rules for this collection area
      const { data: rules } = await supabase
        .from('allocation_rules')
        .select('*, category!inner(name, capacity_bucket)')
        .eq('collection_area_id', selectedProperty.collection_area_id)

      // Get existing bookings for this property in this FY
      const { data: existingItems } = await supabase
        .from('booking_item')
        .select('no_services, service_type_id, booking!inner(property_id, fy_id, status)')
        .eq('booking.property_id', selectedProperty.id)
        .eq('booking.fy_id', fy.id)
        .not('booking.status', 'in', '("Cancelled","Pending Payment")')

      // Get bookings for history display
      const { data: bookings } = await supabase
        .from('booking')
        .select('ref, status, created_at, booking_item(no_services, service_type_id, service_type!inner(name))')
        .eq('property_id', selectedProperty.id)
        .eq('fy_id', fy.id)
        .not('status', 'in', '("Cancelled","Pending Payment")')
        .order('created_at', { ascending: false })

      // Sum usage per capacity bucket
      type RuleWithCategory = NonNullable<typeof rules>[number]
      const bucketUsage = new Map<string, number>()

      if (existingItems) {
        for (const item of existingItems) {
          const bucket = 'bulk' // default; we'll refine below
          bucketUsage.set(bucket, (bucketUsage.get(bucket) ?? 0) + item.no_services)
        }
      }

      // Build allocation summary per category
      const allocations = (rules ?? []).map((rule: RuleWithCategory) => {
        const category = rule.category as unknown as { name: string; capacity_bucket: string }
        const used = existingItems
          ? existingItems.reduce((sum, item) => sum + item.no_services, 0)
          : 0
        return {
          categoryName: category.name,
          bucket: category.capacity_bucket,
          maxCollections: rule.max_collections,
          used: Math.min(used, rule.max_collections),
          remaining: Math.max(0, rule.max_collections - used),
        }
      })

      return {
        fy,
        allocations,
        bookings: bookings ?? [],
      }
    },
  })

  async function handleAddressSelect(placeId: string, description: string) {
    setNotFound(false)
    setSelectedProperty(null)

    // Look up the address in eligible_properties (case-insensitive contains on street)
    const streetPart = description.split(',')[0] ?? description
    const { data: properties } = await supabase
      .from('eligible_properties')
      .select('*')
      .or(
        `google_place_id.eq.${placeId},formatted_address.ilike.%${streetPart}%,address.ilike.%${streetPart}%`
      )
      .limit(1)

    if (properties && properties.length > 0) {
      setSelectedProperty(properties[0])
    } else {
      setNotFound(true)
    }
  }

  function handleContinue() {
    if (!selectedProperty) return
    const params = new URLSearchParams({
      property_id: selectedProperty.id,
      collection_area_id: selectedProperty.collection_area_id,
      address: selectedProperty.formatted_address ?? selectedProperty.address,
    })
    router.push(`/book/services?${params.toString()}`)
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

      <BookingStepper currentStep={1} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 pb-24 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-bold leading-tight text-[#293F52]">
            Book a Collection
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            Enter your property address to check eligibility and view
            allocations.
          </p>
        </div>

        {/* Search card */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-700">
              Search your property address
            </label>
            <AddressAutocomplete
              onSelect={(placeId, description) =>
                void handleAddressSelect(placeId, description)
              }
              placeholder="Start typing your address..."
            />
          </div>

          {/* Property found banner */}
          {selectedProperty && (
            <div className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-[#00B864] bg-[#E8FDF0] px-4 py-3 text-[13px] font-medium text-[#006A38]">
              <span className="shrink-0 text-base">&#10003;</span>
              <div>
                <div className="font-semibold">Property found!</div>
                <div className="mt-px text-xs font-normal">
                  This property qualifies for verge collection services.
                </div>
              </div>
            </div>
          )}

          {/* Not found */}
          {notFound && (
            <div className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
              <span className="shrink-0 text-base">&#10007;</span>
              <div>
                <div className="font-semibold">Address not eligible</div>
                <div className="mt-px text-xs font-normal">
                  This address is not registered for verge collection services.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Property location */}
        {selectedProperty && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="flex items-center gap-2.5 px-4 py-3.5">
              <span className="text-base text-[#00B864]">&#x1F4CD;</span>
              <div>
                <div className="text-[13px] font-semibold text-[#293F52]">
                  Property Location
                </div>
                <div className="mt-px text-xs text-[#00B864]">
                  {selectedProperty.formatted_address ??
                    selectedProperty.address}
                </div>
              </div>
            </div>
            {/* Map placeholder */}
            <div className="flex h-[190px] items-center justify-center bg-[#dde8d4]">
              <span className="text-sm text-gray-500">Map view</span>
            </div>
          </div>
        )}

        {/* Service Allocations */}
        {selectedProperty && allocationData && (
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-3.5 flex items-center gap-2">
              <span className="text-base">&#x1F4E6;</span>
              <span className="font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]">
                Service Allocations &mdash; {allocationData.fy.label}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {allocationData.allocations.map((alloc) => (
                <div
                  key={alloc.categoryName}
                  className="flex items-center justify-between rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {alloc.categoryName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {alloc.used} of {alloc.maxCollections} included used
                    </div>
                  </div>
                  <div
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-medium ${
                      alloc.bucket === 'bulk'
                        ? 'border-[#00B864] bg-[#E8FDF0] text-[#006A38]'
                        : 'border-[#C7D3DD] bg-[#E8EEF2] text-[#293F52]'
                    }`}
                  >
                    {alloc.remaining} remaining
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleContinue}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-[#293F52] font-[family-name:var(--font-heading)] text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Book New Collection &rarr;
            </button>
          </div>
        )}

        {/* Booking history */}
        {selectedProperty && allocationData && (
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-base">&#x1F550;</span>
              <span className="font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]">
                Booking History &mdash; {allocationData.fy.label}
              </span>
            </div>

            {allocationData.bookings.length === 0 ? (
              <div className="flex items-center gap-2.5">
                <span className="text-base text-[#00B864]">&#10003;</span>
                <span className="text-[13px] text-gray-500">
                  No bookings yet for this financial year.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {allocationData.bookings.map((booking) => (
                  <div
                    key={booking.ref}
                    className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5"
                  >
                    <div>
                      <div className="text-[13px] font-medium text-gray-900">
                        {booking.ref}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {new Date(booking.created_at).toLocaleDateString(
                          'en-AU',
                          { day: 'numeric', month: 'short', year: 'numeric' }
                        )}
                      </div>
                    </div>
                    <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700">
                      {booking.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
