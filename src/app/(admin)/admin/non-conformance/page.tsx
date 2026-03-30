import { Suspense } from 'react'
import { NonConformanceClient } from './non-conformance-client'

export default function NonConformancePage() {
  return (
    <Suspense>
      <NonConformanceClient />
    </Suspense>
  )
}
