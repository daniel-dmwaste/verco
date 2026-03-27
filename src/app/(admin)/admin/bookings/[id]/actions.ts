'use server'

import { createClient } from '@/lib/supabase/server'

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

export async function confirmBooking(bookingId: string): Promise<Result<void>> {
  if (!bookingId) {
    return { ok: false, error: 'Booking ID is required.' }
  }

  const supabase = await createClient()

  // Verify current user has admin/staff role
  const { data: role } = await supabase.rpc('current_user_role')
  const adminRoles = ['client-admin', 'client-staff', 'contractor-admin', 'contractor-staff']
  if (!role || !adminRoles.includes(role)) {
    return { ok: false, error: 'Insufficient permissions.' }
  }

  // Fetch booking to validate status transition
  const { data: booking, error: fetchError } = await supabase
    .from('booking')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return { ok: false, error: 'Booking not found.' }
  }

  if (booking.status !== 'Submitted') {
    return {
      ok: false,
      error: `Cannot confirm a booking with status "${booking.status}". Only Submitted bookings can be confirmed.`,
    }
  }

  const { error: updateError } = await supabase
    .from('booking')
    .update({ status: 'Confirmed' })
    .eq('id', bookingId)

  if (updateError) {
    return { ok: false, error: updateError.message }
  }

  return { ok: true, data: undefined }
}

export async function cancelBooking(bookingId: string): Promise<Result<void>> {
  if (!bookingId) {
    return { ok: false, error: 'Booking ID is required.' }
  }

  const supabase = await createClient()

  // Verify current user has admin/staff role
  const { data: role } = await supabase.rpc('current_user_role')
  const adminRoles = ['client-admin', 'client-staff', 'contractor-admin', 'contractor-staff']
  if (!role || !adminRoles.includes(role)) {
    return { ok: false, error: 'Insufficient permissions.' }
  }

  const { data: booking, error: fetchError } = await supabase
    .from('booking')
    .select('id, status, booking_item(collection_date!inner(date))')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return { ok: false, error: 'Booking not found.' }
  }

  const cancellableStatuses = ['Submitted', 'Confirmed']
  if (!cancellableStatuses.includes(booking.status)) {
    return {
      ok: false,
      error: `Cannot cancel a booking with status "${booking.status}".`,
    }
  }

  // Check cutoff: 3:30pm AWST the day prior to collection
  const items = booking.booking_item as Array<{ collection_date: { date: string } }>
  if (items.length > 0) {
    const collectionDateStr = items[0]?.collection_date?.date
    if (collectionDateStr) {
      const collectionDate = new Date(collectionDateStr + 'T00:00:00+08:00')
      const cutoff = new Date(collectionDate)
      cutoff.setDate(cutoff.getDate() - 1)
      cutoff.setHours(15, 30, 0, 0)

      const nowAWST = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Australia/Perth' })
      )

      if (nowAWST >= cutoff) {
        return {
          ok: false,
          error: 'Cancellation cutoff has passed (3:30pm the day before collection).',
        }
      }
    }
  }

  const { error: updateError } = await supabase
    .from('booking')
    .update({
      status: 'Cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', bookingId)

  if (updateError) {
    return { ok: false, error: updateError.message }
  }

  return { ok: true, data: undefined }
}
