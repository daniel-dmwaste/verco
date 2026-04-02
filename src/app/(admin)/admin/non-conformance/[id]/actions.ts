'use server'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

const STAFF_ROLES = ['contractor-admin', 'contractor-staff', 'client-admin', 'client-staff']

async function verifyStaffRole() {
  const supabase = await createClient()
  const { data: role } = await supabase.rpc('current_user_role')
  if (!role || !STAFF_ROLES.includes(role)) return null
  const { data: { user } } = await supabase.auth.getUser()
  return user ? { supabase, userId: user.id } : null
}

export async function updateNcnStatus(
  ncnId: string,
  status: 'Under Review' | 'Resolved',
  resolutionNotes: string,
  contractorFault: boolean,
): Promise<Result<void>> {
  const auth = await verifyStaffRole()
  if (!auth) return { ok: false, error: 'Insufficient permissions.' }

  const { supabase, userId } = auth

  // contractor_fault added in migration 20260401110000 — cast until types regen
  const update: Record<string, unknown> = {
    status,
    resolution_notes: resolutionNotes || null,
    contractor_fault: contractorFault,
  }
  if (status === 'Resolved') {
    update.resolved_at = new Date().toISOString()
    update.resolved_by = userId
  }

  const { error } = await supabase
    .from('non_conformance_notice')
    .update(update as never)
    .eq('id', ncnId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

export async function rebookNcn(
  ncnId: string,
  collectionDateId: string,
  resolutionNotes: string,
  contractorFault: boolean,
): Promise<Result<{ newBookingRef: string }>> {
  const auth = await verifyStaffRole()
  if (!auth) return { ok: false, error: 'Insufficient permissions.' }

  const { supabase, userId } = auth

  // Fetch the NCN with its booking and items
  const { data: ncn, error: ncnError } = await supabase
    .from('non_conformance_notice')
    .select(
      `id, status, booking_id,
       booking:booking_id(
         id, ref, status, type, property_id, contact_id, collection_area_id, client_id, contractor_id, fy_id, location, notes,
         booking_item(no_services, is_extra, unit_price_cents, service_id)
       )`
    )
    .eq('id', ncnId)
    .single()

  if (ncnError || !ncn) return { ok: false, error: 'NCN not found.' }

  if (ncn.status === 'Resolved' || ncn.status === 'Rescheduled') {
    return { ok: false, error: `NCN is already ${ncn.status}.` }
  }

  const booking = ncn.booking as unknown as {
    id: string
    ref: string
    type: string
    property_id: string | null
    contact_id: string | null
    collection_area_id: string
    client_id: string
    contractor_id: string
    fy_id: string
    location: string | null
    notes: string | null
    booking_item: Array<{
      no_services: number
      is_extra: boolean
      unit_price_cents: number
      service_id: string
    }>
  }

  if (!booking) return { ok: false, error: 'Linked booking not found.' }

  // Fetch the selected collection date
  const { data: collDate } = await supabase
    .from('collection_date')
    .select('id, date')
    .eq('id', collectionDateId)
    .single()

  if (!collDate) return { ok: false, error: 'Collection date not found.' }

  // Generate a booking ref
  const { data: refData, error: refError } = await supabase
    .rpc('generate_booking_ref', { p_area_code: '' })

  // Fallback ref if RPC fails
  const newRef = refError || !refData
    ? `RBK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    : refData as string

  // Create the new booking (rebook — no payment required)
  type BookingType = Database['public']['Enums']['booking_type']

  const { data: newBooking, error: bookingError } = await supabase
    .from('booking')
    .insert({
      ref: newRef,
      status: 'Submitted',
      type: booking.type as BookingType,
      property_id: booking.property_id,
      contact_id: booking.contact_id,
      collection_area_id: booking.collection_area_id,
      client_id: booking.client_id,
      contractor_id: booking.contractor_id,
      fy_id: booking.fy_id,
      location: booking.location,
      notes: `Rebooked from ${booking.ref} (NCN)`,
    })
    .select('id, ref')
    .single()

  if (bookingError || !newBooking) {
    return { ok: false, error: bookingError?.message ?? 'Failed to create rebooked booking.' }
  }

  // Clone booking items with the new collection date
  const newItems = booking.booking_item.map((item) => ({
    booking_id: newBooking.id,
    service_id: item.service_id,
    collection_date_id: collectionDateId,
    no_services: item.no_services,
    is_extra: item.is_extra,
    unit_price_cents: contractorFault ? 0 : item.unit_price_cents,
  }))

  if (newItems.length > 0) {
    const { error: itemsError } = await supabase
      .from('booking_item')
      .insert(newItems)

    if (itemsError) {
      return { ok: false, error: `Booking created but items failed: ${itemsError.message}` }
    }
  }

  // Update the NCN (contractor_fault not in types yet — cast)
  const ncnUpdate: Record<string, unknown> = {
    status: 'Rescheduled',
    resolution_notes: resolutionNotes || null,
    contractor_fault: contractorFault,
    resolved_at: new Date().toISOString(),
    resolved_by: userId,
    rescheduled_booking_id: newBooking.id,
    rescheduled_date: collDate.date,
  }
  const { error: ncnUpdateError } = await supabase
    .from('non_conformance_notice')
    .update(ncnUpdate as never)
    .eq('id', ncnId)

  if (ncnUpdateError) {
    return { ok: false, error: `Rebook created but NCN update failed: ${ncnUpdateError.message}` }
  }

  // Update original booking status to Rebooked
  await supabase
    .from('booking')
    .update({ status: 'Rebooked' })
    .eq('id', booking.id)

  return { ok: true, data: { newBookingRef: newBooking.ref } }
}

export async function resolveWithRefund(
  ncnId: string,
  resolutionNotes: string,
): Promise<Result<void>> {
  const auth = await verifyStaffRole()
  if (!auth) return { ok: false, error: 'Insufficient permissions.' }

  const { supabase, userId } = auth

  // Fetch NCN with booking payment info
  const { data: ncn } = await supabase
    .from('non_conformance_notice')
    .select('id, status, booking_id')
    .eq('id', ncnId)
    .single()

  if (!ncn) return { ok: false, error: 'NCN not found.' }

  if (ncn.status === 'Resolved' || ncn.status === 'Rescheduled') {
    return { ok: false, error: `NCN is already ${ncn.status}.` }
  }

  // Resolve the NCN (contractor_fault not in types yet — cast)
  const resolveUpdate: Record<string, unknown> = {
    status: 'Resolved',
    resolution_notes: resolutionNotes || null,
    contractor_fault: true,
    resolved_at: new Date().toISOString(),
    resolved_by: userId,
  }
  const { error: updateError } = await supabase
    .from('non_conformance_notice')
    .update(resolveUpdate as never)
    .eq('id', ncnId)

  if (updateError) return { ok: false, error: updateError.message }

  // Trigger refund via process-refund Edge Function
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-refund`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ booking_id: ncn.booking_id, reason: 'Contractor fault — NCN resolution' }),
      }
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error')
      // NCN is already resolved — log the refund failure but don't fail the action
      console.error(`Refund trigger failed for booking ${ncn.booking_id}: ${errText}`)
    }
  }

  return { ok: true, data: undefined }
}
