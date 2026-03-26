'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { BookingStepper } from '@/components/booking/booking-stepper'
import { LOCATION_OPTIONS, type LocationOption } from '@/lib/booking/schemas'
import { cn } from '@/lib/utils'

export function DetailsForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const propertyId = searchParams.get('property_id') ?? ''
  const collectionAreaId = searchParams.get('collection_area_id') ?? ''
  const address = searchParams.get('address') ?? ''
  const itemsParam = searchParams.get('items') ?? ''
  const totalCents = searchParams.get('total_cents') ?? '0'
  const collectionDateId = searchParams.get('collection_date_id') ?? ''

  const [location, setLocation] = useState<LocationOption>('Front Verge')
  const [notes, setNotes] = useState('')

  function handleContinue() {
    const params = new URLSearchParams({
      property_id: propertyId,
      collection_area_id: collectionAreaId,
      address,
      items: itemsParam,
      total_cents: totalCents,
      collection_date_id: collectionDateId,
      location,
      ...(notes ? { notes } : {}),
    })
    router.push(`/book/confirm?${params.toString()}`)
  }

  function handleBack() {
    const params = new URLSearchParams({
      property_id: propertyId,
      collection_area_id: collectionAreaId,
      address,
      items: itemsParam,
      total_cents: totalCents,
    })
    router.push(`/book/date?${params.toString()}`)
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

      <BookingStepper currentStep={4} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 pb-24 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-bold leading-tight text-[#293F52]">
            Collection Details
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            Confirm where we should collect from on your property.
          </p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm">
          {/* Address */}
          <div className="mb-1 text-[13px] font-semibold text-[#293F52]">
            Address
          </div>
          <div className="mb-4 text-[13px] text-gray-700">{address}</div>

          <div className="mb-4 h-px bg-gray-100" />

          {/* Location on property */}
          <div className="mb-3 text-[13px] font-semibold text-[#293F52]">
            Location on Property
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {LOCATION_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setLocation(opt)}
                className={cn(
                  'rounded-full border-[1.5px] px-4 py-2 text-[13px] font-medium transition-colors',
                  location === opt
                    ? 'border-[#293F52] bg-[#293F52] text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          <div className="mb-4 h-px bg-gray-100" />

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="notes"
              className="text-xs font-medium text-gray-700"
            >
              Notes for Driver (Optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder="e.g. will be on the other street side of the property"
              className="h-20 w-full resize-none rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-300 focus:border-[#293F52] focus:bg-white"
            />
          </div>
        </div>
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
          className="flex h-[52px] flex-1 items-center justify-center rounded-xl bg-[#293F52] font-[family-name:var(--font-heading)] text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Next Step &rarr;
        </button>
      </div>
    </div>
  )
}
