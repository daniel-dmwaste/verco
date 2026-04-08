'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { BookingStepper } from '@/components/booking/booking-stepper'
import { AddressAutocomplete } from '@/components/booking/address-autocomplete'
import { stripAddressPrefix } from '@/lib/mud/address-strip'
import { decideMudRedirect, type MudLookupCandidate } from '@/lib/mud/mud-lookup'
import type { Database } from '@/lib/supabase/types'

type EligibleProperty = Database['public']['Tables']['eligible_properties']['Row']

interface MudRedirectState {
  building_address: string
  contact_email: string | null
}

const PropertyMap = dynamic(
  () =>
    import('@/components/booking/property-map').then((mod) => mod.PropertyMap),
  { ssr: false }
)

export function AddressForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const initialAddress = searchParams.get('address') ?? ''
  const onBehalf = searchParams.get('on_behalf') === 'true'

  const [selectedProperty, setSelectedProperty] = useState<EligibleProperty | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [hasAutoResolved, setHasAutoResolved] = useState(false)
  const [mudRedirect, setMudRedirect] = useState<MudRedirectState | null>(null)

  // Shared lookup function used by both manual selection and auto-resolve.
  //
  // Tries the input as-is first; if no match is found, retries with the
  // address prefix stripped (e.g. "Unit 5 / 18 Sulphur Rd" → "18 Sulphur Rd")
  // to catch residents who entered their MUD address with a unit prefix.
  // If the resolved property is a MUD, blocks the booking flow and renders
  // the redirect message instead of advancing.
  const lookupProperty = useCallback(
    async (searchStr: string) => {
      setNotFound(false)
      setSelectedProperty(null)
      setMudRedirect(null)

      const tryLookup = async (s: string) => {
        const streetPart = s.split(',')[0] ?? s
        const { data } = await supabase
          .from('eligible_properties')
          .select('*')
          .or(`formatted_address.ilike.%${streetPart}%,address.ilike.%${streetPart}%`)
          .limit(1)
        return data?.[0] ?? null
      }

      let property = await tryLookup(searchStr)

      // Fallback: strip a Unit/Apt/Lot prefix and retry
      if (!property) {
        const stripped = stripAddressPrefix(searchStr)
        if (stripped !== searchStr) {
          property = await tryLookup(stripped)
        }
      }

      if (!property) {
        setNotFound(true)
        return
      }

      // MUD redirect check via the pure decision helper
      const candidate: MudLookupCandidate = {
        id: property.id,
        formatted_address: property.formatted_address,
        address: property.address,
        is_mud: property.is_mud,
        is_eligible: property.is_eligible,
      }
      const decision = decideMudRedirect([candidate])
      if (decision.redirect) {
        // Fetch the resolved client's contact email for the redirect link
        const { data: client } = await supabase
          .from('client')
          .select('contact_email')
          .limit(1)
          .maybeSingle()
        setMudRedirect({
          building_address: decision.building_address ?? property.address,
          contact_email: client?.contact_email ?? null,
        })
        return
      }

      setSelectedProperty(property)
    },
    [supabase]
  )

  // Auto-resolve address from search params on mount
  useEffect(() => {
    if (initialAddress && !hasAutoResolved) {
      setHasAutoResolved(true)
      void lookupProperty(initialAddress)
    }
  }, [initialAddress, hasAutoResolved, lookupProperty])

  // Fetch FY allocation at category level when a property is selected
  const { data: allocationData } = useQuery({
    queryKey: ['allocations', selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      if (!selectedProperty) return null

      const { data: fy } = await supabase
        .from('financial_year')
        .select('id, label')
        .eq('is_current', true)
        .single()

      if (!fy) return null

      if (!selectedProperty.collection_area_id) return null

      const { data: rules } = await supabase
        .from('allocation_rules')
        .select('max_collections, category!inner(name, code)')
        .eq('collection_area_id', selectedProperty.collection_area_id)

      const { data: usageItems } = await supabase
        .from('booking_item')
        .select(
          'no_services, service!inner(category!inner(code)), booking!inner(property_id, fy_id, status)'
        )
        .eq('booking.property_id', selectedProperty.id)
        .eq('booking.fy_id', fy.id)
        .not('booking.status', 'in', '("Cancelled","Pending Payment")')

      const usageByCode = new Map<string, number>()
      if (usageItems) {
        for (const item of usageItems) {
          const svc = item.service as unknown as { category: { code: string } }
          const code = svc.category.code
          usageByCode.set(code, (usageByCode.get(code) ?? 0) + item.no_services)
        }
      }

      const allocations = (rules ?? []).map((rule) => {
        const cat = rule.category as unknown as { name: string; code: string }
        const used = usageByCode.get(cat.code) ?? 0
        return {
          categoryName: cat.name,
          code: cat.code,
          maxCollections: rule.max_collections,
          used: Math.min(used, rule.max_collections),
          remaining: Math.max(0, rule.max_collections - used),
        }
      })

      const { data: bookings } = await supabase
        .from('booking')
        .select('ref, status, created_at')
        .eq('property_id', selectedProperty.id)
        .eq('fy_id', fy.id)
        .not('status', 'in', '("Cancelled","Pending Payment")')
        .order('created_at', { ascending: false })
        .limit(5)

      return { fy, allocations, bookings: bookings ?? [] }
    },
  })

  function handleAddressSelect(placeId: string, description: string) {
    void lookupProperty(description)
  }

  function handleContinue() {
    if (!selectedProperty || !selectedProperty.collection_area_id) return
    const params = new URLSearchParams({
      property_id: selectedProperty.id,
      collection_area_id: selectedProperty.collection_area_id,
      address: selectedProperty.formatted_address ?? selectedProperty.address,
      ...(onBehalf ? { on_behalf: 'true' } : {}),
    })
    router.push(`/book/services?${params.toString()}`)
  }

  const hasCoords =
    selectedProperty?.has_geocode &&
    selectedProperty.latitude !== null &&
    selectedProperty.longitude !== null

  return (
    <div className="flex flex-col">
      <BookingStepper currentStep={1} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-24 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-bold leading-tight text-[#293F52]">
            Book a Collection
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            Enter your property address to check eligibility and view
            allocations.
          </p>
        </div>

        {/* Search card — full width */}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-700">
              Search your property address
            </label>
            <AddressAutocomplete
              onSelect={handleAddressSelect}
              placeholder="Start typing your address..."
              initialValue={initialAddress}
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

          {/* MUD redirect — block individual bookings, point to strata manager */}
          {mudRedirect && (
            <div className="mt-3 rounded-[10px] border border-[#805AD5] bg-[#F3EEFF] px-4 py-4 text-[13px] text-[#293F52]">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-base">&#x1F3E2;</span>
                <div className="flex-1">
                  <div className="font-semibold text-[#5B348B]">
                    Multi-unit property
                  </div>
                  <p className="mt-1 leading-relaxed">
                    Collections for <strong>{mudRedirect.building_address}</strong> are
                    arranged centrally — please contact your strata manager or building
                    manager to organise a collection.
                  </p>
                  {mudRedirect.contact_email && (
                    <p className="mt-2 text-[12px]">
                      If you think this is wrong, contact our team at{' '}
                      <a
                        href={`mailto:${mudRedirect.contact_email}`}
                        className="font-medium text-[#5B348B] underline"
                      >
                        {mudRedirect.contact_email}
                      </a>
                      .
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Two-column grid: Map (left) + Allocations (right) */}
        {selectedProperty && allocationData && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Left: Property location + map */}
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

              {/* Map or placeholder */}
              {hasCoords ? (
                <PropertyMap
                  lat={Number(selectedProperty.latitude)}
                  lng={Number(selectedProperty.longitude)}
                  address={
                    selectedProperty.formatted_address ??
                    selectedProperty.address
                  }
                />
              ) : (
                <div className="flex h-[190px] flex-col items-center justify-center gap-1 bg-[#dde8d4]">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#7A7A7A"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="text-xs text-gray-500">
                    Map unavailable &mdash; geocode pending
                  </span>
                </div>
              )}
            </div>

            {/* Right: Allocation tiles + Book button */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <div className="mb-3.5 flex items-center gap-2">
                <span className="text-base">&#x1F4E6;</span>
                <span className="font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]">
                  Service Allocations &mdash; {allocationData.fy.label}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {allocationData.allocations.map((alloc) => (
                  <div
                    key={alloc.code}
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
                        alloc.remaining > 0
                          ? 'border-[#00B864] bg-[#E8FDF0] text-[#006A38]'
                          : 'border-[#E53E3E] bg-[#FFF0F0] text-[#E53E3E]'
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
          </div>
        )}

        {/* Booking history — full width below the grid */}
        {selectedProperty && allocationData && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
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
