/**
 * Node-compatible mirror of supabase/functions/_shared/schedule-transition.ts.
 * Keep in sync with the Edge Function version.
 *
 * Unit-tested via Vitest. The authoritative implementation lives in _shared/
 * so the Edge Function has no Deno-vs-Node import mismatch.
 */

export interface BookingWithItemDates {
  id: string
  booking_item: Array<{ collection_date: { date: string } | null }>
}

/**
 * Returns the AWST calendar date (YYYY-MM-DD) for the given UTC instant.
 * AWST is UTC+8 year-round (no DST).
 */
export function awstDateFromUtc(nowUtc: Date): string {
  const awstMs = nowUtc.getTime() + 8 * 60 * 60 * 1000
  return new Date(awstMs).toISOString().slice(0, 10)
}

/** Returns YYYY-MM-DD for the day after the given YYYY-MM-DD string. */
export function addOneDay(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Filters bookings whose earliest collection_date equals targetDate.
 * Matches the MIN(collection_date.date) semantics of the
 * enforce_cancellation_cutoff trigger — keep aligned if cutoff rules change.
 */
export function filterBookingsReadyToSchedule(
  bookings: BookingWithItemDates[],
  targetDate: string,
): string[] {
  const ids: string[] = []
  for (const booking of bookings) {
    const dates = booking.booking_item
      .map((item) => item.collection_date?.date)
      .filter((d): d is string => Boolean(d))
    if (dates.length === 0) continue
    const earliest = dates.reduce((min, d) => (d < min ? d : min))
    if (earliest === targetDate) ids.push(booking.id)
  }
  return ids
}
