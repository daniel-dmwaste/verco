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
    .select('id, status, contact_id, client_id, booking_item(unit_price_cents, no_services, is_extra, collection_date!inner(date))')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return { ok: false, error: 'Booking not found.' }
  }

  const cancellableStatuses = ['Pending Payment', 'Submitted', 'Confirmed']
  if (!cancellableStatuses.includes(booking.status)) {
    return {
      ok: false,
      error: `Cannot cancel a booking with status "${booking.status}".`,
    }
  }

  // Check cutoff: 3:30pm AWST the day prior to collection
  const items = booking.booking_item as Array<{ unit_price_cents: number; no_services: number; is_extra: boolean; collection_date: { date: string } }>
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

  // If booking has paid items, create refund_request and trigger Stripe refund
  const paidItems = items.filter((i) => i.is_extra && i.unit_price_cents > 0)
  const refundAmountCents = paidItems.reduce((sum, i) => sum + i.unit_price_cents * i.no_services, 0)

  if (refundAmountCents > 0 && booking.contact_id && booking.client_id) {
    const { data: refundReq, error: refundInsertError } = await supabase
      .from('refund_request')
      .insert({
        booking_id: booking.id,
        contact_id: booking.contact_id,
        client_id: booking.client_id,
        amount_cents: refundAmountCents,
        reason: 'Booking cancelled by staff',
        status: 'Pending',
      })
      .select('id')
      .single()

    if (!refundInsertError && refundReq) {
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
            body: JSON.stringify({ refund_request_id: refundReq.id }),
          }
        )

        if (!res.ok) {
          const errText = await res.text().catch(() => 'Unknown error')
          console.error(`Refund trigger failed for cancelled booking ${booking.id}: ${errText}`)
          // Booking is already cancelled, refund_request in Pending — staff can retry from refunds page
        }
      }
    } else {
      console.error('Failed to create refund_request for cancelled booking:', refundInsertError?.message)
    }
  }

  // Fire booking_cancelled notification. Fire-and-forget — failure never
  // reverts the cancel. Uses direct fetch() per CLAUDE.md §11 (supabase
  // .functions.invoke is unreliable in SSR).
  await invokeSendNotification(supabase, {
    type: 'booking_cancelled',
    booking_id: bookingId,
    // No reason field captured in the admin UI yet — Phase 2 (VER-120)
    // may add a reason prompt to the cancel dialog.
  })

  return { ok: true, data: undefined }
}

/**
 * Fire-and-forget POST to the send-notification Edge Function.
 *
 * Uses the **user's session access token** (NOT the service role key — that
 * would violate CLAUDE.md §20 Red Line #3). The EF accepts two auth modes:
 *   1. Service role bearer (EF→EF calls from create-booking, stripe-webhook, crons)
 *   2. Valid user JWT (server-action→EF calls like this one) — the EF then
 *      verifies the user's role is in the permitted set before dispatching
 *
 * Internal PII access inside the EF uses service role regardless of the
 * caller — the triggering user's role authorises the send, but the actual
 * contact lookup is elevated-privilege work that happens inside the EF.
 *
 * Fire-and-forget: the caller operation (cancelBooking, etc.) has already
 * committed before this runs, so notification failure never breaks the
 * user-facing flow.
 */
async function invokeSendNotification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: {
    type: 'booking_created' | 'booking_cancelled'
    booking_id: string
    reason?: string
  }
): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    if (!supabaseUrl) {
      console.error(
        '[notifications] NEXT_PUBLIC_SUPABASE_URL not set — skipping send-notification'
      )
      return
    }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      console.error(
        '[notifications] No session access token — skipping send-notification'
      )
      return
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      console.error(
        `[notifications] send-notification returned ${res.status} for ${payload.type} ${payload.booking_id}: ${body}`
      )
    }
  } catch (err) {
    console.error(
      `[notifications] Failed to invoke send-notification for ${payload.type} ${payload.booking_id}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

export async function updateContact(
  contactId: string,
  data: { full_name: string; email: string; mobile_e164: string | null },
): Promise<Result<void>> {
  const supabase = await createClient()

  const { data: role } = await supabase.rpc('current_user_role')
  const adminRoles = ['client-admin', 'client-staff', 'contractor-admin', 'contractor-staff']
  if (!role || !adminRoles.includes(role)) {
    return { ok: false, error: 'Insufficient permissions.' }
  }

  if (!data.full_name.trim() || !data.email.trim()) {
    return { ok: false, error: 'Name and email are required.' }
  }

  const { error } = await supabase
    .from('contacts')
    .update({
      full_name: data.full_name.trim(),
      email: data.email.trim().toLowerCase(),
      mobile_e164: data.mobile_e164?.trim() || null,
    })
    .eq('id', contactId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

export async function updateCollectionDetails(
  bookingId: string,
  data: { location: string; collection_date_id: string | null },
): Promise<Result<void>> {
  const supabase = await createClient()

  const { data: role } = await supabase.rpc('current_user_role')
  const adminRoles = ['client-admin', 'client-staff', 'contractor-admin', 'contractor-staff']
  if (!role || !adminRoles.includes(role)) {
    return { ok: false, error: 'Insufficient permissions.' }
  }

  // Update booking location
  const { error: bookingError } = await supabase
    .from('booking')
    .update({ location: data.location })
    .eq('id', bookingId)

  if (bookingError) return { ok: false, error: bookingError.message }

  // Update collection_date_id on all booking_items if changed
  if (data.collection_date_id) {
    const { error: itemError } = await supabase
      .from('booking_item')
      .update({ collection_date_id: data.collection_date_id })
      .eq('booking_id', bookingId)

    if (itemError) return { ok: false, error: itemError.message }
  }

  return { ok: true, data: undefined }
}

export async function updateNotes(
  bookingId: string,
  notes: string,
): Promise<Result<void>> {
  const supabase = await createClient()

  const { data: role } = await supabase.rpc('current_user_role')
  const adminRoles = ['client-admin', 'client-staff', 'contractor-admin', 'contractor-staff']
  if (!role || !adminRoles.includes(role)) {
    return { ok: false, error: 'Insufficient permissions.' }
  }

  const { error } = await supabase
    .from('booking')
    .update({ notes: notes.trim() || null })
    .eq('id', bookingId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
