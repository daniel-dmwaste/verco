import type { BookingForDispatch } from './types.ts'
import { renderEmailLayout } from './_layout.ts'
import type { RenderedEmail } from './booking-created.ts'

function formatCurrency(cents: number): string {
  const dollars = cents / 100
  return dollars.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

function formatCollectionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00+08:00`)
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function renderPaymentReminder(booking: BookingForDispatch, appUrl: string): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  const bodyHtml = `
    <p style="margin:0 0 16px 0">You started a verge collection booking but haven't completed payment yet.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#293F52;font-size:13px;font-weight:600;border-top:1px solid #F0F2F5">Amount due</td><td style="padding:6px 0;color:#293F52;font-size:13px;font-weight:600;text-align:right;border-top:1px solid #F0F2F5">${formatCurrency(booking.total_charge_cents)}</td></tr>
    </table>
    <p style="margin:0 0 16px 0">Complete your payment to confirm the booking.</p>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/booking/${encodeURIComponent(ref)}`

  return {
    subject: `Complete your booking — ${ref}`,
    html: renderEmailLayout({ client: booking.client, preheader: `You have an unpaid verge collection booking — ${ref}`, heading: 'Complete your booking', bodyHtml, ctaText: 'Complete payment', ctaUrl }),
  }
}
