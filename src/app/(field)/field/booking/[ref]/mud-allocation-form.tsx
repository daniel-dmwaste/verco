'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { updateMudAllocation } from './actions'
import { VercoButton } from '@/components/ui/verco-button'

interface MudAllocationFormProps {
  bookingRef: string
  bookingItemId: string
  address: string
  preBooked: number
}

export function MudAllocationForm({
  bookingRef,
  bookingItemId,
  address,
  preBooked,
}: MudAllocationFormProps) {
  const router = useRouter()
  const [count, setCount] = useState(preBooked)
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!confirm('This allocation count is final once submitted. Continue?'))
      return

    setIsSubmitting(true)
    setError(null)

    const result = await updateMudAllocation(bookingItemId, count)

    if (!result.ok) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    router.push('/field/run-sheet')
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Run Sheet
        </Link>
        <div>
          <div className="font-[family-name:var(--font-heading)] text-base font-bold text-[var(--brand)]">
            {bookingRef}{' '}
            <span className="text-xs font-normal text-gray-500">
              &middot; MUD
            </span>
          </div>
          <div className="mt-0.5 text-[13px] text-gray-500">{address}</div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-24 pt-4">
        {/* Info banner */}
        <div className="rounded-[10px] border border-[#FF8C42] bg-[#FFF3EA] px-3.5 py-3">
          <div className="mb-1 text-[13px] font-semibold text-[#8B4000]">
            MUD Collection &mdash; Allocation Entry
          </div>
          <div className="text-xs text-[#8B4000]">
            Enter the actual number of bulk allocations collected. Pre-booked:{' '}
            {preBooked}. This value is final once submitted.
          </div>
        </div>

        {/* Allocation counter */}
        <div className="flex flex-col gap-2 rounded-xl bg-white p-3.5 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Actual Allocations Collected
          </div>
          <div className="flex flex-col items-center gap-4 py-6">
            {/* Large circular counter */}
            <div className="flex size-[100px] items-center justify-center rounded-full bg-[var(--brand)] shadow-[0_8px_24px_rgba(41,63,82,0.3)]">
              <span className="font-[family-name:var(--font-heading)] text-[40px] font-bold text-[var(--brand-accent)]">
                {count}
              </span>
            </div>

            {/* +/- buttons */}
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => setCount((c) => Math.max(0, c - 1))}
                className="flex size-[52px] items-center justify-center rounded-full border-2 border-gray-100 bg-white text-[28px] font-bold text-[var(--brand)] shadow-sm"
              >
                &minus;
              </button>
              <span className="text-[13px] text-gray-500">allocations</span>
              <button
                type="button"
                onClick={() => setCount((c) => c + 1)}
                className="flex size-[52px] items-center justify-center rounded-full border-2 border-[var(--brand)] bg-[var(--brand)] text-[28px] font-bold text-[var(--brand-accent)] shadow-[0_4px_12px_rgba(41,63,82,0.3)]"
              >
                +
              </button>
            </div>

            <div className="text-xs text-gray-500">
              Pre-booked: {preBooked} &middot; You&apos;re entering: {count}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-2 rounded-xl bg-white p-3.5 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Notes (Optional)
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. large volume, overflow from adjacent unit..."
            className="h-[72px] w-full resize-none rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-[13px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-[var(--brand)] focus:bg-white"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        {/* Submit */}
        <VercoButton
          variant="accent"
          className="w-full"
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Confirm Allocation & Complete'}
        </VercoButton>
      </div>
    </>
  )
}
