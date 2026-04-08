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

  // Property + collection area + (optional) strata contact
  const { data: property } = await supabase
    .from('eligible_properties')
    .select(
      `id, address, formatted_address, latitude, longitude, has_geocode,
       is_eligible, is_mud, unit_count, mud_code, mud_onboarding_status,
       collection_cadence, waste_location_notes, auth_form_url,
       collection_area_id,
       collection_area:collection_area_id(id, name, code),
       strata_contact:strata_contact_id(id, full_name, mobile_e164, email)`
    )
    .eq('id', id)
    .single()

  if (!property) {
    redirect('/admin/properties')
  }

  // Recent bookings against this property — used by both SUD + MUD detail
  const { data: bookings } = await supabase
    .from('booking')
    .select(
      `id, ref, status, type, created_at,
       booking_item(no_services, actual_services,
         service:service_id(name),
         collection_date:collection_date_id(date))`
    )
    .eq('property_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  // Cadence-based "next expected" date — only present for Registered MUDs
  let nextExpected: { last_date: string | null; next_expected_date: string | null } | null = null
  if (property.is_mud && property.mud_onboarding_status === 'Registered') {
    const { data: nx } = await supabase
      .from('v_mud_next_expected')
      .select('last_date, next_expected_date')
      .eq('property_id', id)
      .maybeSingle()
    nextExpected = nx ?? null
  }

  // Signed URL for auth form (1h TTL) — only when one is uploaded
  let authFormSignedUrl: string | null = null
  if (property.auth_form_url) {
    const { data: signed } = await supabase.storage
      .from('mud-auth-forms')
      .createSignedUrl(property.auth_form_url, 60 * 60)
    authFormSignedUrl = signed?.signedUrl ?? null
  }

  return (
    <PropertyDetailClient
      property={property}
      bookings={bookings ?? []}
      nextExpected={nextExpected}
      authFormSignedUrl={authFormSignedUrl}
    />
  )
}
