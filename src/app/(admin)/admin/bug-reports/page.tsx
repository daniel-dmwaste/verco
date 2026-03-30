import { Suspense } from 'react'
import { BugReportsClient } from './bug-reports-client'

export default function BugReportsPage() {
  return (
    <Suspense>
      <BugReportsClient />
    </Suspense>
  )
}
