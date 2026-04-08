'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { MudDetailSection } from './mud-detail-section'

type CollectionArea = { id: string; name: string; code: string } | null

type Property = {
  id: string
  address: string
  formatted_address: string | null
  latitude: number | null
  longitude: number | null
  has_geocode: boolean
  is_eligible: boolean
  is_mud: boolean
  unit_count: number
  mud_code: string | null
  mud_onboarding_status: 'Contact Made' | 'Registered' | 'Inactive' | null
  collection_cadence: 'Ad-hoc' | 'Annual' | 'Bi-annual' | 'Quarterly' | null
  waste_location_notes: string | null
  auth_form_url: string | null
  collection_area_id: string | null
  collection_area: CollectionArea | CollectionArea[] | null
  strata_contact:
    | { id: string; full_name: string; mobile_e164: string | null; email: string }
    | { id: string; full_name: string; mobile_e164: string | null; email: string }[]
    | null
}

type BookingItem = {
  no_services: number
  actual_services: number | null
  service: { name: string } | { name: string }[] | null
  collection_date: { date: string } | { date: string }[] | null
}

type Booking = {
  id: string
  ref: string
  status: string
  type: string
  created_at: string
  booking_item: BookingItem[] | null
}

interface PropertyDetailClientProps {
  property: Property
  bookings: Booking[]
  nextExpected: { last_date: string | null; next_expected_date: string | null } | null
  authFormSignedUrl: string | null
}

function pickOne<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export function PropertyDetailClient({
  property,
  bookings,
  nextExpected,
  authFormSignedUrl,
}: PropertyDetailClientProps) {
  const area = pickOne(property.collection_area)
  const strataContact = pickOne(property.strata_contact)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-7 pb-5 pt-6">
        <Link
          href="/admin/properties"
          className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-[#293F52]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Properties
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[#293F52]">
              {property.formatted_address ?? property.address}
            </h1>
            <p className="mt-0.5 text-[13px] text-gray-500">
              {area?.code ?? '—'} · {area?.name ?? 'no area'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {property.is_mud && (
              <span className="rounded-full bg-[#F3EEFF] px-3 py-1 text-[11px] font-semibold text-[#805AD5]">
                {property.mud_code ?? 'MUD'}
              </span>
            )}
            {!property.is_eligible && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                Not eligible
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F8F9FA] px-7 py-5">
        <div className="grid gap-5 md:grid-cols-2">
          {/* Property details */}
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Property
            </h2>
            <div className="mt-3 space-y-2.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-gray-500">Address</span>
                <span className="text-right text-[#293F52]">
                  {property.formatted_address ?? property.address}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Collection area</span>
                <span className="text-right text-[#293F52]">{area?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Geocoded</span>
                <span className="text-right text-[#293F52]">
                  {property.has_geocode ? 'Yes' : 'Pending'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Eligible</span>
                <span className="text-right text-[#293F52]">
                  {property.is_eligible ? 'Yes' : 'No (tip-pass council)'}
                </span>
              </div>
            </div>
          </div>

          {/* MUD section — conditional */}
          {property.is_mud ? (
            <MudDetailSection
              property={property}
              strataContact={strataContact}
              nextExpected={nextExpected}
              authFormSignedUrl={authFormSignedUrl}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-5 text-center text-[13px] text-gray-400">
              <p>Single-unit dwelling</p>
              <p className="mt-1 text-[11px]">Convert to MUD via the Set MUD action on the properties list.</p>
            </div>
          )}

          {/* Bookings history — full width on mobile, full row on desktop */}
          <div className="rounded-xl bg-white p-5 shadow-sm md:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Booking history
              </h2>
              <span className="text-[11px] text-gray-400">{bookings.length} most recent</span>
            </div>
            {bookings.length === 0 ? (
              <p className="mt-3 text-[12px] text-gray-400">No bookings yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-[10px] uppercase tracking-wide text-gray-400">
                      <th className="px-2 py-2">Ref</th>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Created</th>
                      <th className="px-2 py-2">Services</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => {
                      const services = (b.booking_item ?? [])
                        .map((bi) => {
                          const svc = pickOne(bi.service)
                          return svc?.name ?? '?'
                        })
                        .filter((n, i, arr) => arr.indexOf(n) === i)
                        .join(', ')
                      return (
                        <tr key={b.id} className="border-b border-gray-50">
                          <td className="px-2 py-2 font-mono text-[#293F52]">
                            <Link href={`/admin/bookings/${b.id}`} className="hover:underline">
                              {b.ref}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-gray-500">{b.type}</td>
                          <td className="px-2 py-2 text-gray-700">{b.status}</td>
                          <td className="px-2 py-2 text-gray-500">
                            {format(new Date(b.created_at), 'd MMM yyyy')}
                          </td>
                          <td className="px-2 py-2 text-gray-700">{services || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
