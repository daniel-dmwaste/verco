import { Suspense } from 'react'
import { BookingsListClient } from './bookings-list-client'

export default function BookingsPage() {
  return (
    <Suspense>
      <BookingsListClient />
    </Suspense>
  )
}
