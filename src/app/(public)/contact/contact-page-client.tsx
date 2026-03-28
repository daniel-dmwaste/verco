'use client'

import { useSearchParams } from 'next/navigation'
import { ServiceTicketForm } from '@/components/tickets/service-ticket-form'

interface ContactPageClientProps {
  clientId: string
}

export function ContactPageClient({ clientId }: ContactPageClientProps) {
  const searchParams = useSearchParams()
  const bookingRef = searchParams.get('booking_ref') ?? undefined
  const bookingId = searchParams.get('booking_id') ?? undefined

  return (
    <ServiceTicketForm
      clientId={clientId}
      bookingRef={bookingRef}
      bookingId={bookingId}
    />
  )
}
