'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  format,
  differenceInDays,
  subDays,
  setHours,
  setMinutes,
} from 'date-fns'
import { BookingStatusBadge } from '@/components/booking/booking-status-badge'
import { cancelBooking } from './actions'
import type { Database } from '@/lib/supabase/types'

type BookingStatus = Database['public']['Enums']['booking_status']
type TicketStatus = Database['public']['Enums']['ticket_status']
type TicketCategory = Database['public']['Enums']['ticket_category']

interface BookingItem {
  id: string
  no_services: number
  is_extra: boolean
  unit_price_cents: number
  service: { name: string }
  collection_date: { date: string }
}

interface Ticket {
  id: string
  display_id: string
  subject: string
  status: TicketStatus
  category: TicketCategory
  created_at: string
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

interface BookingDetailClientProps {
  booking: Booking
  tickets: Ticket[]
}

const TICKET_STATUS_COLORS: Record<TicketStatus, { dot: string; bg: string; text: string; label: string }> = {
  open: { dot: 'bg-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', label: 'Open' },
  in_progress: { dot: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Progress' },
  waiting_on_customer: { dot: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-700', label: 'Awaiting Reply' },
  resolved: { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Resolved' },
  closed: { dot: 'bg-gray-400', bg: 'bg-gray-100', text: 'text-gray-600', label: 'Closed' },
}

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  general: 'General',
  booking: 'Booking Enquiry',
  billing: 'Billing',
  service: 'Service Issue',
  complaint: 'Complaint',
  other: 'Other',
}

function getCollectionDate(booking: Booking): string | null {
  if (booking.booking_item.length === 0) return null
  return booking.booking_item[0]?.collection_date?.date ?? null
}

function getCutoffDate(collectionDateStr: string): Date {
  const collectionDate = new Date(collectionDateStr + 'T00:00:00')
  const dayBefore = subDays(collectionDate, 1)
  return setMinutes(setHours(dayBefore, 15), 30)
}

const CANCELLABLE_STATUSES: BookingStatus[] = ['Submitted', 'Confirmed']

export function BookingDetailClient({ booking, tickets }: BookingDetailClientProps) {
  const router = useRouter()
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const collectionDateStr = getCollectionDate(booking)
  const collectionDateObj = collectionDateStr
    ? new Date(collectionDateStr + 'T00:00:00')
    : null
  const daysUntil =
    collectionDateStr !== null
      ? differenceInDays(
          new Date(collectionDateStr + 'T00:00:00'),
          new Date()
        )
      : null
  const showPlaceOut = daysUntil !== null && daysUntil >= 0 && daysUntil <= 3
  const canCancel = CANCELLABLE_STATUSES.includes(booking.status)

  const includedItems = booking.booking_item.filter((i) => !i.is_extra)
  const extraItems = booking.booking_item.filter((i) => i.is_extra)

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel this booking?')) return
    setIsCancelling(true)
    setCancelError(null)

    const result = await cancelBooking(booking.id)

    if (!result.ok) {
      setCancelError(result.error)
      setIsCancelling(false)
      return
    }

    router.refresh()
  }

  return (
    <div className="flex flex-col">
      {/* Detail header */}
      <div className="shrink-0 border-b border-gray-100 bg-white px-5 py-4">
        <Link
          href="/dashboard"
          className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium text-[#8FA5B8]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          My Dashboard
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-heading)] text-[17px] font-bold text-[#293F52]">
              {booking.ref}
            </h1>
            <p className="mt-0.5 text-[13px] text-gray-500">
              {(booking.collection_area as { name: string }).name} &middot;{' '}
              {booking.type}
            </p>
          </div>
          <BookingStatusBadge status={booking.status} />
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 px-5 pb-24 pt-4">
        {/* Place-out reminder */}
        {showPlaceOut && collectionDateStr && (
          <div className="rounded-[10px] border border-[#00B864] bg-gradient-to-br from-[#E8FDF0] to-[#d4f5e6] px-3.5 py-3">
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
            <div className="text-xs leading-snug text-gray-700">
              Items must be on the verge by{' '}
              <strong>
                7am{' '}
                {format(collectionDateObj!, 'EEEE d MMMM')}
              </strong>
              . Do not place out more than 48 hours before collection.
            </div>
          </div>
        )}

        {/* Collection details */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Collection Details
          </div>
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 py-2 text-[13px]">
              <span className="text-xs text-gray-500">Date</span>
              <span className="font-medium text-gray-900">
                {collectionDateObj
                  ? format(collectionDateObj, 'EEEE, d MMMM yyyy')
                  : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 py-2 text-[13px]">
              <span className="text-xs text-gray-500">Area</span>
              <span className="font-medium text-gray-900">
                {(booking.collection_area as { name: string }).name}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 py-2 text-[13px]">
              <span className="text-xs text-gray-500">Location</span>
              <span className="font-medium text-gray-900">
                {booking.location ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 text-[13px]">
              <span className="text-xs text-gray-500">Notes</span>
              <span className="font-medium text-gray-500 italic">
                {booking.notes ?? '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Services
          </div>
          <div className="flex flex-col gap-1.5">
            {includedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg bg-[#E8FDF0] px-2.5 py-2 text-[13px]"
              >
                <span className="text-gray-900">
                  {(item.service as { name: string }).name} &times;{' '}
                  {item.no_services}
                </span>
                <span className="font-medium text-[#006A38]">Included</span>
              </div>
            ))}
            {extraItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg bg-[#FFF3EA] px-2.5 py-2 text-[13px]"
              >
                <span className="text-gray-900">
                  {(item.service as { name: string }).name} &times;{' '}
                  {item.no_services} (extra)
                </span>
                <span className="font-semibold text-[#8B4000]">
                  $
                  {(
                    (item.unit_price_cents * item.no_services) /
                    100
                  ).toFixed(2)}{' '}
                  paid
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Cancellation cutoff notice */}
        {canCancel && collectionDateStr && (
          <div className="rounded-[10px] bg-[#E8EEF2] px-3.5 py-3 text-xs text-[#293F52]">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
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
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Cancellation cutoff
            </div>
            You can cancel this booking until{' '}
            <strong>
              {format(getCutoffDate(collectionDateStr), "h:mmaaa EEEE d MMMM")}
            </strong>
            . After this time the booking is locked.
          </div>
        )}

        {cancelError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {cancelError}
          </div>
        )}

        {/* Enquiries */}
        {tickets.length > 0 && (
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Enquiries
              </span>
              <span className="flex size-5 items-center justify-center rounded-full bg-[#E8EEF2] text-[10px] font-bold text-[#293F52]">
                {tickets.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {tickets.map((ticket) => {
                const statusStyle = TICKET_STATUS_COLORS[ticket.status]
                return (
                  <Link
                    key={ticket.id}
                    href={`/contact/tickets/${ticket.display_id}`}
                    className="block rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:border-[#293F52]/20 hover:bg-gray-50"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[11px] text-gray-400">
                        {ticket.display_id}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle.bg} ${statusStyle.text}`}
                      >
                        <span className={`size-1.5 rounded-full ${statusStyle.dot}`} />
                        {statusStyle.label}
                      </span>
                    </div>
                    <div className="text-[13px] font-semibold text-[#293F52]">
                      {ticket.subject}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500">
                        {CATEGORY_LABELS[ticket.category]}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {format(new Date(ticket.created_at), 'd MMM yyyy')}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Get Help / Raise Another Enquiry */}
        <Link
          href={`/contact?booking_ref=${encodeURIComponent(booking.ref)}&booking_id=${encodeURIComponent(booking.id)}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#293F52] bg-white px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {tickets.length > 0
            ? 'Raise Another Enquiry \u2192'
            : 'Get Help with this Booking \u2192'}
        </Link>

        {/* Actions */}
        {canCancel && (
          <div className="flex flex-col gap-2">
            <Link
              href={`/book?edit=${booking.ref}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-100 bg-white px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit Booking
            </Link>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCancelling}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#E53E3E] bg-[#FFF0F0] px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#E53E3E] disabled:opacity-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              {isCancelling ? 'Cancelling...' : 'Cancel Booking'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
