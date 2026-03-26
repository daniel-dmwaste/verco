import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from './dashboard-client'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth')
  }

  // Fetch profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .eq('id', user.id)
    .single()

  // Fetch current FY
  const { data: fy } = await supabase
    .from('financial_year')
    .select('id, label')
    .eq('is_current', true)
    .single()

  // Fetch bookings for this user (RLS scopes to own bookings)
  const { data: bookings } = await supabase
    .from('booking')
    .select(
      `
      id,
      ref,
      status,
      type,
      location,
      notes,
      created_at,
      collection_area!inner(name),
      booking_item(
        id,
        no_services,
        is_extra,
        unit_price_cents,
        service!inner(name),
        collection_date!inner(date)
      )
    `
    )
    .eq('fy_id', fy?.id ?? '')
    .not('status', 'eq', 'Pending Payment')
    .order('created_at', { ascending: false })

  // Fetch open service tickets (RLS scopes to own tickets)
  const { data: tickets } = await supabase
    .from('service_ticket')
    .select('id, display_id, subject, status, category, created_at')
    .in('status', ['open', 'in_progress', 'waiting_on_customer'])
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <DashboardClient
      profile={profile}
      fyLabel={fy?.label ?? ''}
      bookings={bookings ?? []}
      tickets={tickets ?? []}
    />
  )
}
