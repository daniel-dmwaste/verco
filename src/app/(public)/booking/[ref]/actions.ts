'use server'

import { createClient } from '@/lib/supabase/server'

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

/**
 * Cancel a booking. Checks the cancellation cutoff (3:30pm AWST day before
 * collection) before proceeding. RLS ensures the user can only cancel their
 * own bookings.
 */
export async function cancelBooking(bookingId: string): Promise<Result<void>> {
  if (!bookingId) {
    return { ok: false, error: 'Booking ID is required.' }
  }

  const supabase = await createClient()

  // Fetch the booking to check its current status and collection date
  const { data: booking, error: fetchError } = await supabase
    .from('booking')
    .select(
      'id, status, booking_item(collection_date!inner(date))'
    )
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return { ok: false, error: 'Booking not found.' }
  }

  // Only allow cancellation from pre-Scheduled statuses
  const cancellableStatuses = ['Pending Payment', 'Submitted', 'Confirmed']
  if (!cancellableStatuses.includes(booking.status)) {
    return {
      ok: false,
      error: `Cannot cancel a booking with status "${booking.status}".`,
    }
  }

  // Check cutoff: 3:30pm AWST the day prior to collection
  const items = booking.booking_item as Array<{
    collection_date: { date: string }
  }>
  if (items.length > 0) {
    const collectionDateStr = items[0]?.collection_date?.date
    if (collectionDateStr) {
      const collectionDate = new Date(collectionDateStr + 'T00:00:00+08:00') // AWST
      const cutoff = new Date(collectionDate)
      cutoff.setDate(cutoff.getDate() - 1)
      cutoff.setHours(15, 30, 0, 0) // 3:30pm AWST

      const nowAWST = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Australia/Perth' })
      )

      if (nowAWST >= cutoff) {
        return {
          ok: false,
          error:
            'Cancellation cutoff has passed (3:30pm the day before collection).',
        }
      }
    }
  }

  // Perform the cancellation
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

/**
 * Dispute an NCN. Resident can only dispute notices in 'Issued' status
 * on their own bookings. RLS policy enforces ownership + status transition.
 */
export async function disputeNcn(ncnId: string): Promise<Result<void>> {
  if (!ncnId) return { ok: false, error: 'NCN ID is required.' }

  const supabase = await createClient()

  // RLS policy ncn_resident_update_dispute enforces: status must be 'Issued' + own booking
  const { error } = await supabase
    .from('non_conformance_notice')
    .update({ status: 'Disputed' })
    .eq('id', ncnId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/**
 * Dispute a Nothing Presented notice. Same pattern as NCN dispute.
 */
export async function disputeNp(npId: string): Promise<Result<void>> {
  if (!npId) return { ok: false, error: 'NP ID is required.' }

  const supabase = await createClient()

  const { error } = await supabase
    .from('nothing_presented')
    .update({ status: 'Disputed' })
    .eq('id', npId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
