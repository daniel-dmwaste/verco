import { Suspense } from 'react'
import { AllocationsList } from './allocations-list'

export default function AllocationsPage() {
  return (
    <Suspense>
      <AllocationsList />
    </Suspense>
  )
}
