import { Suspense } from 'react'
import { ServiceTicketsClient } from './service-tickets-client'

export default function ServiceTicketsPage() {
  return (
    <Suspense>
      <ServiceTicketsClient />
    </Suspense>
  )
}
