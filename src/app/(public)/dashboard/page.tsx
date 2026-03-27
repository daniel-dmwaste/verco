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

  // Fetch profile with contact join for authoritative name
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, contact_id, contacts(full_name)')
    .eq('id', user.id)
    .single()

  // Resolve display name: contacts.full_name → email prefix
  const contactRow = profile?.contacts as { full_name: string } | null
  const displayName = contactRow?.full_name
    ?? user.email?.split('@')[0]
    ?? ''

  // Fetch current FY
  const { data: fy } = await supabase
    .from('financial_year')
    .select('id, label')
    .eq('is_current', true)
    .single()

  // Fetch bookings — RLS policy handles scoping via contact_id OR email fallback
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
      geo_address,
      collection_area!inner(name),
      eligible_properties(formatted_address),
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
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <DashboardClient
        displayName={displayName}
        fyLabel={fy?.label ?? ''}
        bookings={bookings ?? []}
        tickets={tickets ?? []}
      />
    </main>
  )
}
