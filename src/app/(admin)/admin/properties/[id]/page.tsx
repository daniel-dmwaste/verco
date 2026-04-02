import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PropertyDetailClient } from './property-detail-client'

interface PropertyDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function AdminPropertyDetailPage({
  params,
}: PropertyDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  // Step 1: Fetch property + current FY in parallel (needed for subsequent queries)
  const [{ data: property }, { data: fy }] = await Promise.all([
    supabase
      .from('eligible_properties')
      .select('*, collection_area!inner(id, name, code)')
      .eq('id', id)
      .single(),
    supabase
      .from('financial_year')
      .select('id, label')
      .eq('is_current', true)
      .single(),
  ])

  if (!property) {
    redirect('/admin/properties')
  }

  if (!fy) {
    redirect('/admin/properties')
  }

  // Step 2: Fetch bookings for this property in current FY
  const { data: bookings } = await supabase
    .from('booking')
    .select(
      `id, ref, status, type, created_at,
       contact:contact_id(full_name),
       booking_item(no_services, service!inner(name), collection_date!inner(date))`
    )
    .eq('property_id', id)
    .eq('fy_id', fy.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const bookingIds = (bookings ?? []).map((b) => b.id)

  // Step 3: Fetch NCNs, NPs, service tickets, allocation overrides, allocation rules, FY usage in parallel
  const [
    { data: ncns },
    { data: nps },
    { data: serviceTickets },
    { data: allocationOverrides },
    { data: allocationRules },
    { data: fyUsage },
  ] = await Promise.all([
    // NCNs via booking IDs
    bookingIds.length > 0
      ? supabase
          .from('non_conformance_notice')
          .select(
            'id, status, contractor_fault, reported_at, booking:booking!non_conformance_notice_booking_id_fkey(id, ref)'
          )
          .in('booking_id', bookingIds)
      : Promise.resolve({ data: [] as never[] }),

    // NPs via booking IDs
    bookingIds.length > 0
      ? supabase
          .from('nothing_presented')
          .select(
            'id, status, contractor_fault, reported_at, booking:booking!nothing_presented_booking_id_fkey(id, ref)'
          )
          .in('booking_id', bookingIds)
      : Promise.resolve({ data: [] as never[] }),

    // Service tickets via booking IDs
    bookingIds.length > 0
      ? supabase
          .from('service_ticket')
          .select('id, display_id, subject, status, created_at')
          .in('booking_id', bookingIds)
      : Promise.resolve({ data: [] as never[] }),

    // Allocation overrides for this property
    supabase
      .from('allocation_override')
      .select(
        'id, extra_allocations, reason, created_at, created_by, service!inner(name, category!inner(name))'
      )
      .eq('property_id', id)
      .order('created_at', { ascending: false }),

    // Allocation rules for this property's collection area
    supabase
      .from('allocation_rules')
      .select('max_collections, category!inner(name, code)')
      .eq('collection_area_id', property.collection_area_id!),

    // FY usage — booking_items for this property in current FY
    supabase
      .from('booking_item')
      .select(
        'no_services, service!inner(category!inner(code)), booking!inner(property_id, fy_id, status)'
      )
      .eq('booking.property_id', id)
      .eq('booking.fy_id', fy.id)
      .not('booking.status', 'in', '("Cancelled","Pending Payment")'),
  ])

  return (
    <PropertyDetailClient
      property={property}
      fy={fy}
      bookings={bookings ?? []}
      ncns={ncns ?? []}
      nps={nps ?? []}
      serviceTickets={serviceTickets ?? []}
      allocationOverrides={allocationOverrides ?? []}
      allocationRules={allocationRules ?? []}
      fyUsage={fyUsage ?? []}
    />
  )
}
