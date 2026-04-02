'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export function BookingCancelLink() {
  const searchParams = useSearchParams()
  const onBehalf = searchParams.get('on_behalf') === 'true'
  const returnUrl = searchParams.get('return_url') ?? (onBehalf ? '/admin/bookings' : '/dashboard')

  return (
    <Link
      href={returnUrl}
      className="flex h-[52px] items-center justify-center rounded-xl border-[1.5px] border-gray-100 bg-white px-4 font-[family-name:var(--font-heading)] text-[13px] font-semibold text-gray-500 transition-opacity hover:opacity-90"
    >
      Cancel
    </Link>
  )
}
