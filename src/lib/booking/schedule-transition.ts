/**
 * Pure helpers for the Confirmed → Scheduled daily cron (VER-148).
 *
 * The cron fires at 15:25 AWST (07:25 UTC) each day. Bookings whose earliest
 * collection date is *tomorrow* AWST transition to Scheduled, because the
 * cancellation cutoff (15:30 AWST the day prior) is about to pass. Using
 * MIN(collection_date.date) matches the enforce_cancellation_cutoff trigger.
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

/**
 * Filters bookings whose earliest item collection_date equals the given date.
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
