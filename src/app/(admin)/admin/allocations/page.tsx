import { Suspense } from 'react'
import { AllocationsList } from './allocations-list'

export const metadata = {
  title: 'Allocation Overrides | Admin',
  description: 'Manage allocation overrides for properties',
}

export default function AllocationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-heading)] text-title font-bold text-[var(--brand)]">
          Allocation Overrides
        </h1>
        <p className="mt-1 text-body-sm text-gray-500">
          Manage manual allocation overrides for property categories (e.g., new owner reinstatement,
          council credits).
        </p>
      </div>

      <Suspense>
        <AllocationsList />
      </Suspense>
    </div>
  )
}
