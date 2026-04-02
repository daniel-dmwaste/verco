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
      className="flex h-[52px] flex-1 items-center justify-center rounded-xl border-[1.5px] border-[#E53E3E] bg-[#FFF0F0] font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#E53E3E] transition-opacity hover:opacity-90"
    >
      Cancel
    </Link>
  )
}
