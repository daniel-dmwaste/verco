import { describe, it, expect } from 'vitest'
import {
  awstDateFromUtc,
  filterBookingsReadyToSchedule,
  type BookingWithItemDates,
} from '@/lib/booking/schedule-transition'

describe('awstDateFromUtc', () => {
  it('converts 07:25 UTC to the same AWST calendar date (15:25 AWST)', () => {
    expect(awstDateFromUtc(new Date('2026-04-15T07:25:00Z'))).toBe('2026-04-15')
  })

  it('rolls the date forward when UTC is late evening (16:01 UTC = 00:01 AWST next day)', () => {
    expect(awstDateFromUtc(new Date('2026-04-15T16:01:00Z'))).toBe('2026-04-16')
  })

  it('stays on the same AWST date for 15:59 UTC (23:59 AWST)', () => {
    expect(awstDateFromUtc(new Date('2026-04-15T15:59:00Z'))).toBe('2026-04-15')
  })

  it('uses a fixed +8h offset (no DST) across years', () => {
    expect(awstDateFromUtc(new Date('2026-07-01T00:00:00Z'))).toBe('2026-07-01')
    expect(awstDateFromUtc(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01')
  })

  it('handles UTC just before midnight rolling to next AWST day', () => {
    expect(awstDateFromUtc(new Date('2026-04-15T23:00:00Z'))).toBe('2026-04-16')
  })
})

describe('filterBookingsReadyToSchedule', () => {
  const tomorrow = '2026-04-16'

  it('returns a booking whose single item is for tomorrow', () => {
    const bookings: BookingWithItemDates[] = [
      {
        id: 'b1',
        booking_item: [{ collection_date: { date: '2026-04-16' } }],
      },
    ]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual(['b1'])
  })

  it('excludes bookings where earliest date is not tomorrow (future)', () => {
    const bookings: BookingWithItemDates[] = [
      {
        id: 'b1',
        booking_item: [{ collection_date: { date: '2026-04-17' } }],
      },
    ]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual([])
  })

  it('excludes bookings where earliest date is not tomorrow (past)', () => {
    const bookings: BookingWithItemDates[] = [
      {
        id: 'b1',
        booking_item: [{ collection_date: { date: '2026-04-14' } }],
      },
    ]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual([])
  })

  it('uses the MIN of multiple item dates', () => {
    const bookings: BookingWithItemDates[] = [
      {
        id: 'b1',
        booking_item: [
          { collection_date: { date: '2026-04-16' } },
          { collection_date: { date: '2026-05-01' } },
        ],
      },
    ]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual(['b1'])
  })

  it('excludes a booking where the earliest item date is today (past cutoff)', () => {
    const bookings: BookingWithItemDates[] = [
      {
        id: 'b1',
        booking_item: [
          { collection_date: { date: '2026-04-15' } },
          { collection_date: { date: '2026-04-16' } },
        ],
      },
    ]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual([])
  })

  it('excludes bookings with no items', () => {
    const bookings: BookingWithItemDates[] = [{ id: 'b1', booking_item: [] }]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual([])
  })

  it('excludes items with null collection_date', () => {
    const bookings: BookingWithItemDates[] = [
      { id: 'b1', booking_item: [{ collection_date: null }] },
    ]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(filterBookingsReadyToSchedule([], tomorrow)).toEqual([])
  })

  it('returns multiple qualifying bookings preserving order', () => {
    const bookings: BookingWithItemDates[] = [
      { id: 'b1', booking_item: [{ collection_date: { date: '2026-04-16' } }] },
      { id: 'b2', booking_item: [{ collection_date: { date: '2026-04-17' } }] },
      { id: 'b3', booking_item: [{ collection_date: { date: '2026-04-16' } }] },
    ]
    expect(filterBookingsReadyToSchedule(bookings, tomorrow)).toEqual(['b1', 'b3'])
  })
})
