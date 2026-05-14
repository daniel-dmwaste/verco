import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { BookingsListClient } from './bookings-list-client'

export default async function BookingsPage() {
  const supabase = await createClient()
  const { data: role } = await supabase.rpc('current_user_role')
  const isContractorAdmin = role === 'contractor-admin'

  return (
    <Suspense>
      <BookingsListClient isContractorAdmin={isContractorAdmin} />
    </Suspense>
  )
}
