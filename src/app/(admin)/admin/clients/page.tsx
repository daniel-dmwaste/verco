import { Suspense } from 'react'
import { ClientsList } from './clients-list'

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsList />
    </Suspense>
  )
}
