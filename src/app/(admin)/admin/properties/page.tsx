import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { PropertiesClient } from './properties-client'

export default async function PropertiesPage() {
  const supabase = await createClient()
  const { data: role } = await supabase.rpc('current_user_role')
  const isContractorAdmin = role === 'contractor-admin'

  return (
    <Suspense>
      <PropertiesClient isContractorAdmin={isContractorAdmin} />
    </Suspense>
  )
}
