import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getCurrentAdminClient,
  getAccessibleAdminClients,
} from '@/lib/admin/current-client'
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

  // Fetch profile with contact join for authoritative name
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, contacts(full_name)')
    .eq('id', user.id)
    .single()

  // Fetch user role for conditional nav rendering
  const { data: userRole } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  const role = userRole?.role ?? null

  // "Current client" comes from the switcher cookie (admin.verco.au) or the
  // proxy x-client-id header (client-subdomain back-compat). Falls back to
  // the user's first accessible client if neither is set.
  const [currentClient, accessibleClients] = await Promise.all([
    getCurrentAdminClient(),
    getAccessibleAdminClients(),
  ])

  // Badge counts (RLS-scoped — contractor users see all their clients;
  // client users see only their own client).
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

  const contactRow = profile?.contacts as { full_name: string } | null
  const fullName = contactRow?.full_name
  const initials = fullName
    ? fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : (profile?.email?.[0] ?? 'U').toUpperCase()

  return (
    <AdminLayoutClient
      currentClient={currentClient}
      accessibleClients={accessibleClients}
      initials={initials}
      counts={counts}
      role={role}
    >
      {children}
    </AdminLayoutClient>
  )
}
