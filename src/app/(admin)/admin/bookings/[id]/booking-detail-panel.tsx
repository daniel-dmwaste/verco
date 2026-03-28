'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { BookingStatusBadge } from '@/components/booking/booking-status-badge'
import { confirmBooking, cancelBooking } from './actions'
import type { Database } from '@/lib/supabase/types'
import type { Json } from '@/lib/supabase/types'

type BookingStatus = Database['public']['Enums']['booking_status']

interface BookingItem {
  id: string
  no_services: number
  is_extra: boolean
  unit_price_cents: number
  service: { name: string }
  collection_date: { date: string }
}

interface AuditLog {
  id: string
  action: string
  created_at: string
  changed_by: string | null
  old_data: Json | null
  new_data: Json | null
}

interface Booking {
  id: string
  ref: string
  status: BookingStatus
  type: string
  location: string | null
  notes: string | null
  created_at: string
  updated_at: string
  collection_area: { name: string; code: string }
  eligible_properties: { formatted_address: string | null; address: string } | null
  contact: { full_name: string; mobile_e164: string | null; email: string } | null
  booking_item: BookingItem[]
}

interface BookingDetailPanelProps {
  booking: Booking
  auditLogs: AuditLog[]
}

export function BookingDetailPanel({
  booking,
  auditLogs,
}: BookingDetailPanelProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const area = booking.collection_area as { name: string; code: string }
  const property = booking.eligible_properties as { formatted_address: string | null; address: string } | null
  const contact = booking.contact as { full_name: string; mobile_e164: string | null; email: string } | null
  const address = property?.formatted_address ?? property?.address ?? '—'

  const collectionDateStr =
    booking.booking_item.length > 0
      ? (booking.booking_item[0]?.collection_date as { date: string })?.date ?? null
      : null

  const includedItems = booking.booking_item.filter((i) => !i.is_extra)
  const extraItems = booking.booking_item.filter((i) => i.is_extra)
  const totalChargeCents = extraItems.reduce(
    (sum, i) => sum + i.unit_price_cents * i.no_services,
    0
  )

  const canConfirm = booking.status === 'Submitted'
  const canCancel = ['Submitted', 'Confirmed'].includes(booking.status)

  async function handleConfirm() {
    setIsPending(true)
    setError(null)
    const result = await confirmBooking(booking.id)
    if (!result.ok) {
      setError(result.error)
      setIsPending(false)
      return
    }
    router.refresh()
  }

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel this booking?')) return
    setIsPending(true)
    setError(null)
    const result = await cancelBooking(booking.id)
    if (!result.ok) {
      setError(result.error)
      setIsPending(false)
      return
    }
    router.refresh()
  }

  return (
    <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l border-gray-100 bg-white">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-100 px-5 pb-4 pt-5">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="font-[family-name:var(--font-heading)] text-base font-bold text-[#293F52]">
              {booking.ref}
            </span>
            <BookingStatusBadge status={booking.status} />
          </div>
          <div className="text-xs text-gray-500">
            {booking.type} &middot; {area.name}
          </div>
        </div>
        <Link
          href="/admin/bookings"
          className="text-lg text-gray-300 hover:text-gray-500"
        >
          &#10005;
        </Link>
      </div>

      {/* Property */}
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Property
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="flex justify-between">
            <span className="w-[120px] shrink-0 text-xs font-medium text-gray-500">Address</span>
            <span className="text-right text-[13px] text-gray-900">{address}</span>
          </div>
          <div className="flex justify-between">
            <span className="w-[120px] shrink-0 text-xs font-medium text-gray-500">Location</span>
            <span className="text-right text-[13px] text-gray-900">{booking.location ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="w-[120px] shrink-0 text-xs font-medium text-gray-500">Collection Date</span>
            <span className="text-right text-[13px] text-gray-900">
              {collectionDateStr
                ? format(new Date(collectionDateStr + 'T00:00:00'), 'EEEE, d MMMM yyyy')
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Contact — visible to admin/staff only, enforced by RLS */}
      {contact && (
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Contact
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-between">
              <span className="w-[120px] shrink-0 text-xs font-medium text-gray-500">Name</span>
              <span className="text-right text-[13px] font-medium text-[#293F52]">{contact.full_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="w-[120px] shrink-0 text-xs font-medium text-gray-500">Mobile</span>
              <span className="text-right text-[13px] font-medium text-[#293F52]">{contact.mobile_e164}</span>
            </div>
            <div className="flex justify-between">
              <span className="w-[120px] shrink-0 text-xs font-medium text-gray-500">Email</span>
              <span className="text-right text-[13px] font-medium text-[#293F52]">{contact.email}</span>
            </div>
          </div>
        </div>
      )}

      {/* Services */}
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Services
        </div>
        <div className="flex flex-col gap-1.5">
          {includedItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg bg-[#E8FDF0] px-2.5 py-2 text-[13px]"
            >
              <span className="text-gray-900">
                {(item.service as { name: string }).name} &times; {item.no_services}
              </span>
              <span className="font-medium text-[#006A38]">Included</span>
            </div>
          ))}
          {extraItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg bg-[#E8EEF2] px-2.5 py-2 text-[13px]"
            >
              <span className="text-gray-900">
                {(item.service as { name: string }).name} &times; {item.no_services} (extra)
              </span>
              <span className="font-semibold text-[#293F52]">
                ${((item.unit_price_cents * item.no_services) / 100).toFixed(2)}
              </span>
            </div>
          ))}
          {totalChargeCents > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-[#293F52] px-2.5 py-2.5 text-[13px]">
              <span className="font-semibold text-white">Total charged</span>
              <span className="font-[family-name:var(--font-heading)] text-[15px] font-bold text-[#00E47C]">
                ${(totalChargeCents / 100).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      {booking.notes && (
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Notes
          </div>
          <p className="text-[13px] italic text-gray-700">{booking.notes}</p>
        </div>
      )}

      {/* Audit trail */}
      {auditLogs.length > 0 && (
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Audit Trail
          </div>
          <div className="flex flex-col gap-2">
            {auditLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2.5">
                <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gray-300" />
                <div>
                  <div className="text-xs font-medium text-gray-900">
                    {log.action}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {format(new Date(log.created_at), 'd MMM yyyy, h:mmaaa')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Actions */}
      {(canConfirm || canCancel) && (
        <div className="flex flex-col gap-2 px-5 py-4">
          {canConfirm && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00E47C] px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52] disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {isPending ? 'Confirming...' : 'Confirm Booking'}
            </button>
          )}
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-100 bg-white px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit Booking
          </button>
          {canCancel && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#E53E3E] bg-[#FFF0F0] px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#E53E3E] disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              {isPending ? 'Cancelling...' : 'Cancel Booking'}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
