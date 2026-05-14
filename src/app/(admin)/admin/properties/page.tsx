import { Suspense } from 'react'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { PropertiesClient } from './properties-client'

export default async function PropertiesPage() {
  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id') ?? ''

  const supabase = await createClient()
  const { data: role } = await supabase.rpc('current_user_role')
  const isContractorAdmin = role === 'contractor-admin'

  return (
    <Suspense>
      <PropertiesClient clientId={clientId} isContractorAdmin={isContractorAdmin} />
    </Suspense>
  )
}
