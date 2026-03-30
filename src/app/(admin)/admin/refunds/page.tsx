import { Suspense } from 'react'
import { RefundsClient } from './refunds-client'

export default function RefundsPage() {
  return (
    <Suspense>
      <RefundsClient />
    </Suspense>
  )
}
