import { Suspense } from 'react'
import { NotificationsClient } from './notifications-client'

export default function NotificationsPage() {
  return (
    <Suspense>
      <NotificationsClient />
    </Suspense>
  )
}
