'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

interface CreateIdBookingInput {
  latitude: number
  longitude: number
  geo_address: string
  collection_date_id: string
  collection_area_id: string
  waste_types: string[]
  volume: string
  description: string
  photo_urls: string[]
  notes: string
}

export async function createIdBooking(
  input: CreateIdBookingInput
): Promise<Result<{ ref: string }>> {
  const supabase = await createClient()

  // Validate ranger role server-side
  const { data: role } = await supabase.rpc('current_user_role')
  if (role !== 'ranger') {
    return { ok: false, error: 'Only ranger role can create ID bookings.' }
  }

  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')
  const contractorId = headerStore.get('x-contractor-id')

  if (!clientId || !contractorId) {
    return { ok: false, error: 'Unable to resolve tenant.' }
  }

  // Validate collection date has ID capacity
  const { data: collDate } = await supabase
    .from('collection_date')
    .select('id, id_capacity_limit, id_units_booked, id_is_closed')
    .eq('id', input.collection_date_id)
    .single()

  if (!collDate) {
    return { ok: false, error: 'Collection date not found.' }
  }

  if (collDate.id_is_closed) {
    return { ok: false, error: 'ID capacity is closed for this date.' }
  }

  if (collDate.id_units_booked >= collDate.id_capacity_limit) {
    return { ok: false, error: 'No ID capacity remaining for this date.' }
  }

  // Get current FY
  const { data: fy } = await supabase
    .from('financial_year')
    .select('id')
    .eq('is_current', true)
    .single()

  if (!fy) {
    return { ok: false, error: 'No active financial year.' }
  }

  // Find the ID service type (Illegal Dumping category)
  const { data: serviceType } = await supabase
    .from('service')
    .select('id, category!inner(code)')
    .eq('category.code', 'id')
    .limit(1)
    .single()

  if (!serviceType) {
    return { ok: false, error: 'ID service not configured.' }
  }

  // Generate ID booking ref: KWN-ID-XXXX
  const refSuffix = Math.floor(1000 + Math.random() * 9000).toString()
  const ref = `ID-${refSuffix}`

  // Insert booking — no property_id, no contact_id for ID bookings
  const { data: booking, error: bookingError } = await supabase
    .from('booking')
    .insert({
      ref,
      type: 'Illegal Dumping',
      status: 'Submitted',
      client_id: clientId,
      contractor_id: contractorId,
      collection_area_id: input.collection_area_id,
      fy_id: fy.id,
      latitude: input.latitude,
      longitude: input.longitude,
      geo_address: input.geo_address,
      notes: [
        input.waste_types.length > 0
          ? `Waste: ${input.waste_types.join(', ')}`
          : '',
        input.volume ? `Volume: ${input.volume}` : '',
        input.description,
        input.photo_urls.length > 0
          ? `Photos: ${input.photo_urls.length}`
          : '',
        input.notes,
      ]
        .filter(Boolean)
        .join('\n'),
    })
    .select('id, ref')
    .single()

  if (bookingError || !booking) {
    return { ok: false, error: bookingError?.message ?? 'Failed to create booking.' }
  }

  // Insert booking_item
  const { error: itemError } = await supabase
    .from('booking_item')
    .insert({
      booking_id: booking.id,
      service_id: serviceType.id,
      collection_date_id: input.collection_date_id,
      no_services: 1,
      is_extra: false,
      unit_price_cents: 0,
    })

  if (itemError) {
    return { ok: false, error: itemError.message }
  }

  return { ok: true, data: { ref: booking.ref } }
}
