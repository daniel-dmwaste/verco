'use client'

import { useSearchParams } from 'next/navigation'
import { VercoButton } from '@/components/ui/verco-button'

export function BookingCancelLink() {
  const searchParams = useSearchParams()
  const onBehalf = searchParams.get('on_behalf') === 'true'
  const returnUrl = searchParams.get('return_url') ?? (onBehalf ? '/admin/bookings' : '/dashboard')

  return (
    <VercoButton href={returnUrl} variant="destructive" className="flex-1">
      Cancel
    </VercoButton>
  )
}
