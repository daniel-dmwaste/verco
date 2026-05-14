import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BugReportsClient } from './bug-reports-client'

export default async function BugReportsPage() {
  // The bug-reports queue is the triage tool for contractor-admin staff.
  // Client-admin / client-staff should not see it (and per RLS the bug_report
  // rows scope to their own tenant anyway, but the queue itself is
  // contractor-internal). 404 keeps the route undiscoverable; sidebar nav is
  // also gated separately.
  const supabase = await createClient()
  const { data: role } = await supabase.rpc('current_user_role')
  if (role !== 'contractor-admin') {
    notFound()
  }

  return (
    <Suspense>
      <BugReportsClient />
    </Suspense>
  )
}
