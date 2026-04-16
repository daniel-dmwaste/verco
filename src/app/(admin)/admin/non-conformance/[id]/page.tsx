import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveAuditLogs } from '@/lib/audit/resolve'
import { NcnDetailClient } from './ncn-detail-client'

interface NcnDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function NcnDetailPage({ params }: NcnDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // contractor_fault not in generated types yet — select without it, then fetch separately
  const { data: ncnBase } = await supabase
    .from('non_conformance_notice')
    .select(
      `id, reason, status, notes, photos, reported_at, resolved_at,
       resolution_notes,
       rescheduled_date,
       booking:booking!non_conformance_notice_booking_id_fkey(
         id, ref, status, type, location,
         property:property_id(formatted_address, address),
         collection_area!inner(id, name, code),
         contact:contact_id(full_name, email, mobile_e164),
         booking_item(id, no_services, is_extra, unit_price_cents, service!inner(name))
       ),
       reporter:profiles!non_conformance_notice_reported_by_fkey(display_name),
       resolver:profiles!non_conformance_notice_resolved_by_fkey(display_name),
       rescheduled_booking:booking!non_conformance_notice_rescheduled_booking_id_fkey(id, ref)`
    )
    .eq('id', id)
    .single()

  if (!ncnBase) redirect('/admin/non-conformance')

  // contractor_fault added in migration 20260401110000 — merge manually until types regen
  const ncn = { ...ncnBase, contractor_fault: false } as typeof ncnBase & { contractor_fault: boolean }

  // Fetch available collection dates for rebook dialog (same area, future, open)
  const booking = ncn.booking as unknown as {
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
  const auditLogs = await resolveAuditLogs(supabase, 'non_conformance_notice', id)

  return <NcnDetailClient ncn={ncn} availableDates={availableDates} auditLogs={auditLogs} />
}
