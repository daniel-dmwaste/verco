import type { BookingForDispatch } from './types.ts'
import { renderEmailLayout } from './_layout.ts'

/**
 * `booking_created` template — sent on transition to Submitted.
 *
 * Fires via:
 *   - `create-booking` EF (free booking path — status = Submitted immediately)
 *   - `stripe-webhook` EF (paid booking path — Pending Payment → Submitted)
 *
 * The template does NOT fire on Pending Payment creation. Abandoned carts
 * never reach this point — they get `payment_reminder` (Phase 4) then
 * `payment_expired` (Phase 4) instead.
 *
 * ## Content
 *
 *   Heading: "Booking confirmed"
 *   Body:
 *     - Brief confirmation line
 *     - Details table: ref, collection date, address, services
 *     - (if total_charge_cents > 0) Total paid line
 *   CTA: "View booking" → {appUrl}/{client_slug}/booking/{ref}
 *
 * ## Pure function
 *
 * Takes booking + appUrl, returns `{ subject, html }`. Mirrored to
 * `supabase/functions/_shared/templates/booking-created.ts` — kept in sync
 * by the template-sync CI job.
 */

export interface RenderedEmail {
  subject: string
  html: string
}

function formatCurrency(cents: number): string {
  const dollars = cents / 100
  return dollars.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
  })
}

function formatCollectionDate(iso: string): string {
  // Treat as date-only in Perth tz — render as "Wed, 15 Apr 2026"
  const date = new Date(`${iso}T00:00:00+08:00`)
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderBookingCreated(
  booking: BookingForDispatch,
  appUrl: string
): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  // Group items by service_name, summing free and paid quantities separately.
  const grouped = new Map<
    string,
    { free: number; paid: number; paidCents: number }
  >()
  for (const item of booking.items) {
    const existing = grouped.get(item.service_name) ?? {
      free: 0,
      paid: 0,
      paidCents: 0,
    }
    if (item.is_extra) {
      existing.paid += item.no_services
      existing.paidCents += item.line_charge_cents
    } else {
      existing.free += item.no_services
    }
    grouped.set(item.service_name, existing)
  }

  const itemRows = Array.from(grouped.entries())
    .map(([name, counts]) => {
      const parts: string[] = []
      if (counts.free > 0) parts.push(`${counts.free} included`)
      if (counts.paid > 0)
        parts.push(`${counts.paid} paid (${formatCurrency(counts.paidCents)})`)
      return `<tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">${escapeHtml(name)}</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${parts.join(' · ')}</td></tr>`
    })
    .join('')

  const totalRow =
    booking.total_charge_cents > 0
      ? `<tr><td style="padding:12px 12px 0 0;color:#293F52;font-size:13px;font-weight:600;border-top:1px solid #F0F2F5">Total paid</td><td style="padding:12px 0 0 0;color:#293F52;font-size:13px;font-weight:600;text-align:right;border-top:1px solid #F0F2F5">${formatCurrency(booking.total_charge_cents)}</td></tr>`
      : ''

  const bodyHtml = `
    <p style="margin:0 0 16px 0">Thanks — your verge collection is booked. Here are the details:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
      ${itemRows}
      ${totalRow}
    </table>
    <p style="margin:0 0 16px 0">You'll get another email closer to the date with a reminder to put your waste on the verge.</p>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/booking/${encodeURIComponent(ref)}`

  return {
    subject: `Booking confirmed — ${ref}`,
    html: renderEmailLayout({
      client: booking.client,
      preheader: `Your verge collection is booked for ${dateStr}`,
      heading: 'Booking confirmed',
      bodyHtml,
      ctaText: 'View booking',
      ctaUrl,
    }),
  }
}
