'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type NcnReason = Database['public']['Enums']['ncn_reason']

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

async function validateFieldRole(): Promise<Result<string>> {
  const supabase = await createClient()
  const { data: role } = await supabase.rpc('current_user_role')
  if (!role || !['field', 'ranger'].includes(role)) {
    return { ok: false, error: 'Insufficient permissions. Field role required.' }
  }
  return { ok: true, data: role }
}

export async function completeBooking(bookingId: string): Promise<Result<void>> {
  const roleCheck = await validateFieldRole()
  if (!roleCheck.ok) return roleCheck

  const supabase = await createClient()

  const { data: booking } = await supabase
    .from('booking')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.status !== 'Scheduled') {
    return { ok: false, error: `Cannot complete a booking with status "${booking.status}".` }
  }

  const { error } = await supabase
    .from('booking')
    .update({ status: 'Completed' })
    .eq('id', bookingId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

export async function raiseNcn(
  bookingId: string,
  reason: NcnReason,
  notes: string,
  photoUrls: string[]
): Promise<Result<void>> {
  const roleCheck = await validateFieldRole()
  if (!roleCheck.ok) return roleCheck

  const supabase = await createClient()
  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')

  if (!clientId) return { ok: false, error: 'Unable to resolve tenant.' }

  const { data: booking } = await supabase
    .from('booking')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.status !== 'Scheduled') {
    return { ok: false, error: `Cannot raise NCN for a booking with status "${booking.status}".` }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Insert non_conformance_notice
  const { error: ncnError } = await supabase
    .from('non_conformance_notice')
    .insert({
      booking_id: bookingId,
      client_id: clientId,
      reason,
      notes: notes || null,
      photos: photoUrls,
      reported_by: user?.id ?? null,
      reported_at: new Date().toISOString(),
      status: 'Issued' as never, // Issued added in migration 20260401130000 — cast until types regen
    })

  if (ncnError) return { ok: false, error: ncnError.message }

  // Transition booking status
  const { error: updateError } = await supabase
    .from('booking')
    .update({ status: 'Non-conformance' })
    .eq('id', bookingId)

  if (updateError) return { ok: false, error: updateError.message }
  return { ok: true, data: undefined }
}

export async function raiseNothingPresented(
  bookingId: string,
  notes: string,
  photoUrls: string[],
  dmFault: boolean
): Promise<Result<void>> {
  const roleCheck = await validateFieldRole()
  if (!roleCheck.ok) return roleCheck

  const supabase = await createClient()
  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')

  if (!clientId) return { ok: false, error: 'Unable to resolve tenant.' }

  const { data: booking } = await supabase
    .from('booking')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.status !== 'Scheduled') {
    return { ok: false, error: `Cannot raise NP for a booking with status "${booking.status}".` }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // contractor_fault renamed from dm_fault in migration 20260401120000 — cast until types regen
  const npInsert: Record<string, unknown> = {
    booking_id: bookingId,
    client_id: clientId,
    notes: notes || null,
    photos: photoUrls,
    contractor_fault: dmFault,
    reported_by: user?.id ?? null,
    reported_at: new Date().toISOString(),
    status: 'Issued' as never, // Issued added in migration 20260401130000 — cast until types regen
  }
  const { error: npError } = await supabase
    .from('nothing_presented')
    .insert(npInsert as never)

  if (npError) return { ok: false, error: npError.message }

  const { error: updateError } = await supabase
    .from('booking')
    .update({ status: 'Nothing Presented' })
    .eq('id', bookingId)

  if (updateError) return { ok: false, error: updateError.message }
  return { ok: true, data: undefined }
}

export async function updateMudAllocation(
  bookingItemId: string,
  actualCount: number
): Promise<Result<void>> {
  const roleCheck = await validateFieldRole()
  if (!roleCheck.ok) return roleCheck

  if (actualCount < 0) return { ok: false, error: 'Count must be 0 or greater.' }

  const supabase = await createClient()

  const { error } = await supabase
    .from('booking_item')
    .update({ actual_services: actualCount })
    .eq('id', bookingItemId)

  if (error) return { ok: false, error: error.message }

  // Also complete the booking
  const { data: item } = await supabase
    .from('booking_item')
    .select('booking_id')
    .eq('id', bookingItemId)
    .single()

  if (item) {
    await supabase
      .from('booking')
      .update({ status: 'Completed' })
      .eq('id', item.booking_id)
  }

  return { ok: true, data: undefined }
}
