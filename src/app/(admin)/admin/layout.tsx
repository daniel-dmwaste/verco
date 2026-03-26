import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { AdminLayoutClient } from './admin-layout-client'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth')
  }

  // Fetch profile for avatar
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', user.id)
    .single()

  // Fetch tenant name from x-client-id header
  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')

  let clientName = ''
  if (clientId) {
    const { data: client } = await supabase
      .from('client')
      .select('name')
      .eq('id', clientId)
      .single()
    clientName = client?.name ?? ''
  }

  // Badge counts (RLS-scoped)
  const [bookingsResult, ncnResult, npResult, ticketsResult] =
    await Promise.all([
      supabase
        .from('booking')
        .select('id', { count: 'exact', head: true })
        .in('status', ['Submitted', 'Confirmed', 'Scheduled']),
      supabase
        .from('booking')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Non-conformance'),
      supabase
        .from('booking')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Nothing Presented'),
      supabase
        .from('service_ticket')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'in_progress']),
    ])

  const counts = {
    bookings: bookingsResult.count ?? 0,
    ncn: ncnResult.count ?? 0,
    np: npResult.count ?? 0,
    tickets: ticketsResult.count ?? 0,
  }

  const initials = profile?.display_name
    ? profile.display_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : (profile?.email?.[0] ?? 'U').toUpperCase()

  return (
    <AdminLayoutClient
      clientName={clientName}
      initials={initials}
      counts={counts}
    >
      {children}
    </AdminLayoutClient>
  )
}
