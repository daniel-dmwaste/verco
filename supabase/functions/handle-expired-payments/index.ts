import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

/**
 * handle-expired-payments cron Edge Function
 *
 * Runs hourly via pg_cron. Service role only — no user context.
 *
 * Two queries:
 *   1. 6h reminder — fresh send for Pending Payment bookings > 6h old
 *      without a prior sent/queued reminder
 *   2. 24h expiry — safe-ordered cancel: insert queued log row, cancel
 *      booking, then dispatch by log_id (crash-safe)
 */

serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const results = {
    reminders_sent: 0,
    reminders_failed: 0,
    expired_cancelled: 0,
    expired_failed: 0,
  }

  try {
    // ── 1. 6h reminder ────────────────────────────────────────────────────
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

    const { data: reminderBookings, error: reminderError } = await supabase
      .from('booking')
      .select('id')
      .eq('status', 'Pending Payment')
      .lt('created_at', sixHoursAgo)

    if (reminderError) {
      console.error('Reminder query error:', reminderError.message)
    }

    // Filter out bookings that already have a sent/queued reminder
    const reminderCandidates: Array<{ id: string }> = []
    for (const booking of (reminderBookings ?? []) as Array<{ id: string }>) {
      const { data: existingLog } = await supabase
        .from('notification_log')
        .select('id')
        .eq('booking_id', booking.id)
        .eq('notification_type', 'payment_reminder')
        .in('status', ['queued', 'sent'])
        .limit(1)

      if (!existingLog || existingLog.length === 0) {
        reminderCandidates.push(booking)
      }
    }

    for (const booking of reminderCandidates) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'payment_reminder',
            booking_id: booking.id,
          }),
        })
        if (res.ok) {
          results.reminders_sent++
        } else {
          results.reminders_failed++
          const body = await res.text().catch(() => '(no body)')
          console.error(`Reminder failed for ${booking.id}: ${body}`)
        }
      } catch (err) {
        results.reminders_failed++
        console.error(`Reminder crashed for ${booking.id}:`, err instanceof Error ? err.message : String(err))
      }
    }

    // ── 2. 24h expiry ─────────────────────────────────────────────────────
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: expiryBookings, error: expiryError } = await supabase
      .from('booking')
      .select('id, client_id, contact_id')
      .eq('status', 'Pending Payment')
      .lt('created_at', twentyFourHoursAgo)

    if (expiryError) {
      console.error('Expiry query error:', expiryError.message)
    }

    for (const booking of (expiryBookings ?? []) as Array<{ id: string; client_id: string; contact_id: string | null }>) {
      try {
        // Step 1: Insert queued notification_log row
        const { data: logRow, error: logError } = await supabase
          .from('notification_log')
          .insert({
            booking_id: booking.id,
            client_id: booking.client_id,
            contact_id: booking.contact_id,
            channel: 'email',
            notification_type: 'payment_expired',
            to_address: 'pending',
            status: 'queued',
          })
          .select('id')
          .single()

        if (logError || !logRow) {
          results.expired_failed++
          console.error(`Expiry log insert failed for ${booking.id}:`, logError?.message)
          continue
        }

        // Step 2: Cancel the booking
        const { error: cancelError } = await supabase
          .from('booking')
          .update({
            status: 'Cancelled',
            cancelled_at: new Date().toISOString(),
          })
          .eq('id', booking.id)

        if (cancelError) {
          results.expired_failed++
          console.error(`Expiry cancel failed for ${booking.id}:`, cancelError.message)
          continue
        }

        // Step 3: Dispatch by log_id (crash-safe — queued row persists if this fails)
        const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            notification_log_id: logRow.id,
          }),
        })

        if (res.ok) {
          results.expired_cancelled++
        } else {
          // Booking IS cancelled, log row stays queued for retry
          results.expired_cancelled++
          const body = await res.text().catch(() => '(no body)')
          console.error(`Expiry notification failed for ${booking.id} (booking cancelled, email pending): ${body}`)
        }
      } catch (err) {
        results.expired_failed++
        console.error(`Expiry crashed for ${booking.id}:`, err instanceof Error ? err.message : String(err))
      }
    }

    console.log(JSON.stringify({ event: 'handle_expired_payments', ...results }))

    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('handle-expired-payments error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
