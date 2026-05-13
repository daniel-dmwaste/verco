/**
 * Pure logic for the generate-collection-dates Edge Function.
 *
 * Keep in sync with supabase/functions/_shared/collection-dates.ts — this is
 * the Node-tested mirror so Vitest can exercise the date math without pulling
 * in Deno or Supabase.
 *
 * Day-of-week convention: 0=Sun, 1=Mon, ..., 6=Sat (matches Postgres EXTRACT(DOW)).
 */

export interface ScheduleEntry {
  /** Either collection_area_id (per-area schedule) or capacity_pool_id (pool schedule). */
  id: string
  day_of_week: number
  bulk_capacity_limit: number
  anc_capacity_limit: number
  id_capacity_limit: number
}

export interface PlannedDate {
  /** ISO YYYY-MM-DD (UTC midnight; safe for Postgres `date` round-trip). */
  date: string
  /** True if this falls on a public_holiday — emit a closed row. */
  is_holiday: boolean
  /** Holiday name if is_holiday, else null. */
  holiday_name: string | null
}

export interface PlannedDateForEntity extends PlannedDate {
  /** The owner id — collection_area_id or capacity_pool_id depending on context. */
  entity_id: string
  day_of_week: number
  bulk_capacity_limit: number
  anc_capacity_limit: number
  id_capacity_limit: number
}

/**
 * Enumerate every date in [start, end) (end-exclusive) as ISO YYYY-MM-DD.
 * Both `start` and `end` are interpreted as UTC. Output dates are also UTC,
 * which is fine for AWST collection scheduling — Australia is always ahead
 * of UTC and the date generator runs at 3am AWST = 19:00 UTC the prior day,
 * so UTC-midnight dates align with AWST collection days.
 */
export function enumerateDates(start: Date, end: Date): string[] {
  const dates: string[] = []
  const cursor = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  ))
  const stop = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  )
  while (cursor.getTime() < stop) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

/**
 * Day-of-week as 0=Sun..6=Sat for a YYYY-MM-DD ISO date string.
 */
export function dayOfWeek(isoDate: string): number {
  // Parse as UTC midnight to avoid local-tz drift.
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay()
}

/**
 * Given a list of schedule entries (per-area or per-pool) and the window
 * [start, end), expand to one planned date per (entity, matching weekday).
 * Holidays are tagged via the `holidaysByDate` lookup; the caller decides
 * what to do with them.
 */
export function planDates(
  schedule: ScheduleEntry[],
  start: Date,
  end: Date,
  holidaysByDate: Map<string, string>,
): PlannedDateForEntity[] {
  const result: PlannedDateForEntity[] = []
  const allDates = enumerateDates(start, end)

  // Group schedule entries by day_of_week so we only iterate dates once.
  const byDow = new Map<number, ScheduleEntry[]>()
  for (const entry of schedule) {
    if (!byDow.has(entry.day_of_week)) {
      byDow.set(entry.day_of_week, [])
    }
    byDow.get(entry.day_of_week)!.push(entry)
  }

  for (const isoDate of allDates) {
    const dow = dayOfWeek(isoDate)
    const entries = byDow.get(dow)
    if (!entries) continue

    const holidayName = holidaysByDate.get(isoDate) ?? null
    const isHoliday = holidayName !== null

    for (const entry of entries) {
      result.push({
        entity_id: entry.id,
        day_of_week: entry.day_of_week,
        date: isoDate,
        is_holiday: isHoliday,
        holiday_name: holidayName,
        bulk_capacity_limit: entry.bulk_capacity_limit,
        anc_capacity_limit: entry.anc_capacity_limit,
        id_capacity_limit: entry.id_capacity_limit,
      })
    }
  }

  return result
}

/**
 * Compute the generation window: from `today` (UTC) to `today + weeks * 7` days.
 * Returns [start, end) as Date objects.
 */
export function windowFromToday(today: Date, weeks: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  ))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + weeks * 7)
  return { start, end }
}
