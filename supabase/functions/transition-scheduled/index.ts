import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

/**
 * transition-scheduled cron Edge Function (VER-148)
 *
 * Fires daily at 15:25 AWST (07:25 UTC) via pg_cron. Service role only —
 * bypasses RLS because the DB trigger enforce_booking_state_transition is the
 * authoritative guard for this transition.
 *
 * Transitions Confirmed bookings to Scheduled when the earliest collection
 * date on the booking is tomorrow (AWST). The cancellation cutoff
 * (15:30 AWST the day prior) is about to pass, so the booking is locked in.
 */

function awstDateFromUtc(nowUtc: Date): string {
  const awstMs = nowUtc.getTime() + 8 * 60 * 60 * 1000
  return new Date(awstMs).toISOString().slice(0, 10)
}

interface BookingRow {
  id: string
  booking_item: Array<{ collection_date: { date: string } | null }>
}

serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const tomorrow = awstDateFromUtc(new Date(Date.now() + 24 * 60 * 60 * 1000))

  const results = {
    tomorrow_awst: tomorrow,
    transitioned: 0,
    failed: 0,
  }

  try {
    const { data: bookings, error: fetchError } = await supabase
      .from('booking')
      .select('id, booking_item(collection_date(date))')
      .eq('status', 'Confirmed')

    if (fetchError) {
      console.error('Booking fetch error:', fetchError.message)
      return new Response(
        JSON.stringify({ ok: false, error: fetchError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const candidateIds: string[] = []
    for (const booking of (bookings ?? []) as BookingRow[]) {
      const dates = booking.booking_item
        .map((item) => item.collection_date?.date)
        .filter((d): d is string => Boolean(d))
      if (dates.length === 0) continue
      const earliest = dates.reduce((min, d) => (d < min ? d : min))
      if (earliest === tomorrow) candidateIds.push(booking.id)
    }

    for (const id of candidateIds) {
      const { error: updateError } = await supabase
        .from('booking')
        .update({ status: 'Scheduled' })
        .eq('id', id)
        .eq('status', 'Confirmed')

      if (updateError) {
        results.failed++
        console.error(`Transition failed for ${id}: ${updateError.message}`)
      } else {
        results.transitioned++
      }
    }

    console.log(JSON.stringify({ event: 'transition_scheduled', ...results }))

    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('transition-scheduled error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
