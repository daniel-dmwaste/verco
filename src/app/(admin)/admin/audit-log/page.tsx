import { Suspense } from 'react'
import { AuditLogClient } from './audit-log-client'

export default function AuditLogPage() {
  return (
    <Suspense>
      <AuditLogClient />
    </Suspense>
  )
}
