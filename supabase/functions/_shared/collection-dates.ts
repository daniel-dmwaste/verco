/**
 * Pure logic for the generate-collection-dates Edge Function.
 *
 * Mirror of src/lib/scheduling/collection-dates.ts — Vitest exercises the
 * Node copy; this is the runtime copy for Deno. Keep them in lockstep.
 *
 * Day-of-week convention: 0=Sun, 1=Mon, ..., 6=Sat (matches Postgres EXTRACT(DOW)).
 */

export interface ScheduleEntry {
  id: string
  day_of_week: number
  bulk_capacity_limit: number
  anc_capacity_limit: number
  id_capacity_limit: number
}

export interface PlannedDateForEntity {
  entity_id: string
  day_of_week: number
  date: string
  is_holiday: boolean
  holiday_name: string | null
  bulk_capacity_limit: number
  anc_capacity_limit: number
  id_capacity_limit: number
}

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

export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay()
}

export function planDates(
  schedule: ScheduleEntry[],
  start: Date,
  end: Date,
  holidaysByDate: Map<string, string>,
): PlannedDateForEntity[] {
  const result: PlannedDateForEntity[] = []
  const allDates = enumerateDates(start, end)

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
