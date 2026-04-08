'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveMudActualServices } from './actions'

interface MudItem {
  id: string
  service_name: string
  pre_booked: number
  initial_count: number | null
}

interface MudAllocationFormProps {
  bookingId: string
  bookingRef: string
  address: string
  items: MudItem[]
}

export function MudAllocationForm({
  bookingId,
  bookingRef,
  address,
  items,
}: MudAllocationFormProps) {
  const router = useRouter()
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {}
    for (const i of items) {
      initial[i.id] = i.initial_count ?? 0
    }
    return initial
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function bump(itemId: string, delta: number) {
    setCounts((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] ?? 0) + delta),
    }))
  }

  async function handleSubmit() {
    setIsSubmitting(true)
    setError(null)

    const result = await saveMudActualServices(
      bookingId,
      items.map((i) => ({
        booking_item_id: i.id,
        actual_count: counts[i.id] ?? 0,
      }))
    )

    if (!result.ok) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    // Routes back to the same close-out screen. Now that all items have
    // actual_services set, the early-return into this form falls through
    // and the standard close-out actions render with Complete/NCN/NP enabled.
    router.refresh()
  }

  return (
    <>
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white px-5 py-4">
        <Link
          href="/field/run-sheet"
          className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium text-[#8FA5B8]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Run Sheet
        </Link>
        <div>
          <div className="font-[family-name:var(--font-heading)] text-base font-bold text-[#293F52]">
            {bookingRef}{' '}
            <span className="text-xs font-normal text-gray-500">&middot; MUD</span>
          </div>
          <div className="mt-0.5 text-[13px] text-gray-500">{address}</div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-24 pt-4">
        {/* Info banner */}
        <div className="rounded-[10px] border border-[#FF8C42] bg-[#FFF3EA] px-3.5 py-3">
          <div className="mb-1 text-[13px] font-semibold text-[#8B4000]">
            MUD Collection — Allocation Entry
          </div>
          <div className="text-xs text-[#8B4000]">
            Enter the actual count collected for each service. Required for all close-out paths
            (Complete, NCN, Nothing Presented). Enter 0 if nothing was collected.
          </div>
        </div>

        {/* One counter per booking item */}
        {items.map((item) => {
          const count = counts[item.id] ?? 0
          return (
            <div
              key={item.id}
              className="flex flex-col gap-2 rounded-xl bg-white p-3.5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {item.service_name}
                </div>
                <div className="text-[10px] text-gray-400">
                  Pre-booked: {item.pre_booked}
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex size-[88px] items-center justify-center rounded-full bg-[#293F52] shadow-[0_8px_24px_rgba(41,63,82,0.3)]">
                  <span className="font-[family-name:var(--font-heading)] text-[36px] font-bold text-[#00E47C]">
                    {count}
                  </span>
                </div>
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    onClick={() => bump(item.id, -1)}
                    className="flex size-[48px] items-center justify-center rounded-full border-2 border-gray-100 bg-white text-[26px] font-bold text-[#293F52] shadow-sm"
                  >
                    &minus;
                  </button>
                  <span className="text-[12px] text-gray-500">collected</span>
                  <button
                    type="button"
                    onClick={() => bump(item.id, 1)}
                    className="flex size-[48px] items-center justify-center rounded-full border-2 border-[#293F52] bg-[#293F52] text-[26px] font-bold text-[#00E47C] shadow-[0_4px_12px_rgba(41,63,82,0.3)]"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex w-full items-center justify-center rounded-xl bg-[#00E47C] px-3.5 py-3.5 text-sm font-semibold text-[#293F52] disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Save Counts & Continue'}
        </button>
      </div>
    </>
  )
}
