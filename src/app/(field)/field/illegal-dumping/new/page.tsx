import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { IdBookingForm } from './id-booking-form'

export default async function NewIdBookingPage() {
  const supabase = await createClient()

  // Validate ranger role — field role cannot create ID bookings (PRD §2.2)
  const { data: role } = await supabase.rpc('current_user_role')
  if (role !== 'ranger') {
    redirect('/field/run-sheet')
  }

  const today = new Date().toISOString().split('T')[0]

  // Fetch ID-eligible collection dates (RLS scopes to accessible clients)
  const { data: dates } = await supabase
    .from('collection_date')
    .select(
      'id, date, id_capacity_limit, id_units_booked, id_is_closed, collection_area!inner(id, code, name)'
    )
    .eq('is_open', true)
    .eq('id_is_closed', false)
    .gte('date', today)
    .order('date', { ascending: true })
    .limit(9)

  return <IdBookingForm collectionDates={dates ?? []} />
}
