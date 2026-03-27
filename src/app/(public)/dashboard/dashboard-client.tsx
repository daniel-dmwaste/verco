'use client'

import Link from 'next/link'
import { differenceInDays, format, subDays, setHours, setMinutes } from 'date-fns'
import { BookingStatusBadge } from '@/components/booking/booking-status-badge'
import type { Database } from '@/lib/supabase/types'

type BookingStatus = Database['public']['Enums']['booking_status']
type TicketStatus = Database['public']['Enums']['ticket_status']

interface BookingItem {
  id: string
  no_services: number
  is_extra: boolean
  unit_price_cents: number
  service: { name: string }
  collection_date: { date: string }
}

interface Booking {
  id: string
  ref: string
  status: BookingStatus
  type: string
  location: string | null
  notes: string | null
  created_at: string
  collection_area: { name: string }
  booking_item: BookingItem[]
}

interface Ticket {
  id: string
  display_id: string
  subject: string
  status: TicketStatus
  category: string
  created_at: string
}

interface Profile {
  id: string
  display_name: string | null
  email: string
}

interface DashboardClientProps {
  profile: Profile | null
  fyLabel: string
  bookings: Booking[]
  tickets: Ticket[]
}

const UPCOMING_STATUSES: BookingStatus[] = [
  'Submitted',
  'Confirmed',
  'Scheduled',
]
const PAST_STATUSES: BookingStatus[] = [
  'Completed',
  'Cancelled',
  'Non-conformance',
  'Nothing Presented',
  'Rebooked',
  'Missed Collection',
]

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function getFirstName(profile: Profile | null): string {
  if (profile?.display_name) {
    return profile.display_name.split(' ')[0] ?? ''
  }
  return ''
}

function getCollectionDate(booking: Booking): string | null {
  if (booking.booking_item.length === 0) return null
  return booking.booking_item[0]?.collection_date?.date ?? null
}

function getDaysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  return differenceInDays(target, now)
}

function getCutoffDate(collectionDateStr: string): Date {
  const collectionDate = new Date(collectionDateStr + 'T00:00:00')
  const dayBefore = subDays(collectionDate, 1)
  return setMinutes(setHours(dayBefore, 15), 30) // 3:30pm day before
}

function getBorderClass(status: BookingStatus): string {
  switch (status) {
    case 'Submitted':
    case 'Confirmed':
      return 'border-l-[#293F52]'
    case 'Scheduled':
      return 'border-l-[#00B864]'
    case 'Completed':
      return 'border-l-gray-300'
    case 'Non-conformance':
      return 'border-l-[#E53E3E]'
    case 'Nothing Presented':
      return 'border-l-[#FF8C42]'
    default:
      return 'border-l-transparent'
  }
}

const TICKET_DOT_COLORS: Partial<Record<TicketStatus, string>> = {
  open: 'bg-[#3182CE]',
  in_progress: 'bg-[#3182CE]',
  waiting_on_customer: 'bg-[#FF8C42]',
  resolved: 'bg-[#00B864]',
}

export function DashboardClient({
  profile,
  fyLabel,
  bookings,
  tickets,
}: DashboardClientProps) {
  const firstName = getFirstName(profile)
  const greeting = getGreeting()

  const upcomingBookings = bookings.filter((b) =>
    UPCOMING_STATUSES.includes(b.status)
  )
  const pastBookings = bookings
    .filter((b) => PAST_STATUSES.includes(b.status))
    .slice(0, 5)

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Navy header */}
      <div className="shrink-0 bg-[#293F52] px-5 pb-5">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-[7px] bg-[#00E47C] font-[family-name:var(--font-heading)] text-base font-bold text-[#293F52]">
              V
            </div>
            <span className="font-[family-name:var(--font-heading)] text-base font-bold text-white">
              VERCO
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-white/[0.12]">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          </div>
        </div>
        <div className="text-[13px] text-[#8FA5B8]">
          {greeting}, {firstName}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex flex-1 flex-col pb-20">
        {/* CTA Banner */}
        <Link
          href="/book"
          className="mx-5 mt-4 flex items-center justify-between rounded-xl bg-[#00E47C] px-4 py-3.5 shadow-[0_4px_12px_rgba(0,228,124,0.3)]"
        >
          <span className="font-[family-name:var(--font-heading)] text-sm font-bold text-[#293F52]">
            Book a Collection
          </span>
          <div className="flex size-8 items-center justify-center rounded-full bg-[#293F52]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
        </Link>

        {/* Upcoming */}
        <div className="px-5 pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]">
              Upcoming
            </h2>
          </div>

          {upcomingBookings.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-6 text-center shadow-sm">
              <div className="flex size-12 items-center justify-center rounded-full bg-gray-100">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#B0B0B0"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-[#293F52]">
                No upcoming bookings
              </span>
              <span className="text-xs text-gray-500">
                You haven&apos;t booked a collection yet for this financial
                year.
              </span>
            </div>
          ) : (
            upcomingBookings.map((booking) => {
              const collectionDateStr = getCollectionDate(booking)
              const daysUntil = collectionDateStr
                ? getDaysUntil(collectionDateStr)
                : null
              const showPlaceOut =
                daysUntil !== null && daysUntil >= 0 && daysUntil <= 3

              return (
                <div key={booking.id} className="mb-2.5">
                  {/* Place-out reminder */}
                  {showPlaceOut && collectionDateStr && (
                    <div className="mb-2.5 rounded-[10px] border border-[#00B864] bg-gradient-to-br from-[#E8FDF0] to-[#d4f5e6] px-3.5 py-3">
                      <div className="mb-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-[#293F52]">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#00B864"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        Place out your waste now
                      </div>
                      <div className="text-xs text-gray-700">
                        Your collection is in{' '}
                        <strong>
                          {daysUntil === 0
                            ? 'today'
                            : daysUntil === 1
                              ? 'tomorrow'
                              : `${daysUntil} days`}
                        </strong>
                        . Items must be on the verge by 7am{' '}
                        {format(
                          new Date(collectionDateStr + 'T00:00:00'),
                          'EEEE d MMMM'
                        )}
                        .
                      </div>
                    </div>
                  )}

                  <Link
                    href={`/booking/${booking.ref}`}
                    className={`block cursor-pointer rounded-xl border-l-4 bg-white p-3.5 shadow-sm ${getBorderClass(booking.status)}`}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <div className="font-[family-name:var(--font-heading)] text-xs font-semibold text-[#8FA5B8]">
                          {booking.ref}
                        </div>
                        {collectionDateStr && (
                          <div className="text-sm font-semibold text-[#293F52]">
                            {format(
                              new Date(collectionDateStr + 'T00:00:00'),
                              'EEE d MMMM yyyy'
                            )}
                          </div>
                        )}
                        <div className="text-xs text-gray-500">
                          {(booking.collection_area as { name: string }).name}
                        </div>
                      </div>
                      <BookingStatusBadge status={booking.status} />
                    </div>

                    {/* Countdown + cutoff warning */}
                    {collectionDateStr &&
                      daysUntil !== null &&
                      daysUntil >= 0 &&
                      daysUntil <= 7 && (
                        <div className="mb-2 flex items-center gap-2 rounded-lg bg-[#E8EEF2] px-3 py-2 text-xs font-medium text-[#293F52]">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          <span>
                            {daysUntil === 0
                              ? 'Today'
                              : daysUntil === 1
                                ? '1 day away'
                                : `${daysUntil} days away`}{' '}
                            &middot;{' '}
                            <strong>
                              cannot cancel after{' '}
                              {format(
                                getCutoffDate(collectionDateStr),
                                "h:mmaaa EEEE"
                              )}
                            </strong>
                          </span>
                        </div>
                      )}

                    {/* Service chips */}
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {booking.booking_item.map((item) => (
                        <span
                          key={item.id}
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                            item.is_extra
                              ? 'bg-[#FFF3EA] text-[#8B4000]'
                              : 'bg-[#E8EEF2] text-[#293F52]'
                          }`}
                        >
                          {(item.service as { name: string }).name} &times;{' '}
                          {item.no_services}
                          {item.is_extra &&
                            ` (extra · $${(
                              (item.unit_price_cents * item.no_services) /
                              100
                            ).toFixed(2)})`}
                        </span>
                      ))}
                    </div>

                    {/* Bottom */}
                    <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                      <span className="text-xs text-gray-500">
                        {booking.location}
                      </span>
                      <span className="text-xs font-semibold text-[#00B864]">
                        View details &rarr;
                      </span>
                    </div>
                  </Link>
                </div>
              )
            })
          )}
        </div>

        {/* Past bookings */}
        {pastBookings.length > 0 && (
          <div className="px-5 pt-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]">
                Past Bookings
              </h2>
            </div>

            {pastBookings.map((booking) => {
              const collectionDateStr = getCollectionDate(booking)
              return (
                <Link
                  key={booking.id}
                  href={`/booking/${booking.ref}`}
                  className={`mb-2.5 block cursor-pointer rounded-xl border-l-4 bg-white p-3.5 shadow-sm ${getBorderClass(booking.status)}`}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <div className="font-[family-name:var(--font-heading)] text-xs font-semibold text-[#8FA5B8]">
                        {booking.ref}
                      </div>
                      {collectionDateStr && (
                        <div className="text-sm font-semibold text-[#293F52]">
                          {format(
                            new Date(collectionDateStr + 'T00:00:00'),
                            'EEE d MMM yyyy'
                          )}
                        </div>
                      )}
                    </div>
                    <BookingStatusBadge status={booking.status} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {booking.booking_item.map((item) => (
                      <span
                        key={item.id}
                        className="inline-flex rounded-full bg-[#E8EEF2] px-2.5 py-0.5 text-[11px] font-medium text-[#293F52]"
                      >
                        {(item.service as { name: string }).name} &times;{' '}
                        {item.no_services}
                      </span>
                    ))}
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* Service tickets */}
        {tickets.length > 0 && (
          <div className="px-5 pb-4 pt-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]">
                Service Tickets
              </h2>
            </div>

            {tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="mb-2.5 flex cursor-pointer items-start gap-2.5 rounded-xl bg-white p-3.5 shadow-sm"
              >
                <div
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    TICKET_DOT_COLORS[ticket.status] ?? 'bg-gray-300'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-gray-900">
                    {ticket.subject}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    Opened{' '}
                    {format(
                      new Date(ticket.created_at),
                      'd MMM yyyy'
                    )}
                  </div>
                </div>
                <BookingStatusBadge
                  status={
                    ticket.status === 'open'
                      ? 'Submitted'
                      : ticket.status === 'in_progress'
                        ? 'Confirmed'
                        : 'Pending Payment'
                  }
                  className={
                    ticket.status === 'open'
                      ? 'bg-[#EBF5FF] text-[#3182CE]'
                      : ticket.status === 'waiting_on_customer'
                        ? 'bg-[#FFF3EA] text-[#8B4000]'
                        : ''
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 flex border-t border-gray-100 bg-white">
        <div className="flex flex-1 flex-col items-center gap-1 pb-4 pt-2.5 text-[10px] font-medium text-[#293F52]">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#293F52"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 pb-4 pt-2.5 text-[10px] font-medium text-gray-500">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#B0B0B0"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
          </svg>
          Bookings
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 pb-4 pt-2.5 text-[10px] font-medium text-gray-500">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#B0B0B0"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Support
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 pb-4 pt-2.5 text-[10px] font-medium text-gray-500">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#B0B0B0"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Account
        </div>
      </div>
    </div>
  )
}
