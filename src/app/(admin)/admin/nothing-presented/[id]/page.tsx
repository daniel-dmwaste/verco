import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveAuditLogs } from '@/lib/audit/resolve'
import { NpDetailClient } from './np-detail-client'

interface NpDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function NpDetailPage({ params }: NpDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: npBase } = await supabase
    .from('nothing_presented')
    .select(
      `id, status, contractor_fault, notes, photos, reported_at, resolved_at,
       resolution_notes,
       rescheduled_date,
       booking:booking!nothing_presented_booking_id_fkey(
         id, ref, status, type, location,
         property:property_id(formatted_address, address),
         collection_area!inner(id, name, code),
         contact:contact_id(full_name, email, mobile_e164),
         booking_item(id, no_services, is_extra, unit_price_cents, service!inner(name))
       ),
       reporter:profiles!nothing_presented_reported_by_fkey(display_name),
       resolver:profiles!nothing_presented_resolved_by_fkey(display_name),
       rescheduled_booking:booking!nothing_presented_rescheduled_booking_id_fkey(id, ref)`
    )
    .eq('id', id)
    .single()

  if (!npBase) redirect('/admin/nothing-presented')

  const np = npBase

  // Fetch available collection dates for rebook dialog (same area, future, open)
  const booking = np.booking as unknown as {
    collection_area: { id: string }
  } | null

  let availableDates: { id: string; date: string }[] = []
  if (booking) {
    const { data } = await supabase
      .from('collection_date')
      .select('id, date')
      .eq('collection_area_id', booking.collection_area.id)
      .eq('is_open', true)
      .gt('date', new Date().toISOString().split('T')[0])
      .order('date', { ascending: true })
      .limit(20)

    availableDates = data ?? []
  }

  // Fetch resolved audit trail
  const auditLogs = await resolveAuditLogs(supabase, 'nothing_presented', id)

  return <NpDetailClient np={np} availableDates={availableDates} auditLogs={auditLogs} />
}
