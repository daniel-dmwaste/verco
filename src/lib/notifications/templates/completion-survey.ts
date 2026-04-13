import type { BookingForDispatch } from './types'
import { renderEmailLayout } from './_layout'
import type { RenderedEmail } from './booking-created'

/**
 * `completion_survey` template — sent when a field user marks a booking as Complete.
 *
 * Fires via the `send-notification` EF, triggered by the `Scheduled → Completed`
 * booking state transition.
 *
 * ## Content
 *
 *   Heading: "Collection complete"
 *   Body:
 *     - Completion confirmation
 *     - Details table: ref, collection date, address
 *     - Feedback ask
 *   CTA: "Complete survey" → {appUrl}/{client_slug}/survey/{surveyToken}
 *
 * ## Pure function
 *
 * Takes booking + appUrl + surveyToken, returns `{ subject, html }`. Mirrored
 * to `supabase/functions/_shared/templates/completion-survey.ts` — kept in
 * sync by the template-sync CI job.
 *
 * No reason, notes, photos, or dispute window — just a friendly "how was it?"
 */

function formatCollectionDate(iso: string): string {
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

export function renderCompletionSurvey(
  booking: BookingForDispatch,
  appUrl: string,
  surveyToken: string
): RenderedEmail {
  const ref = booking.ref
  const dateStr = formatCollectionDate(booking.collection_date)
  const address = booking.address

  const bodyHtml = `
    <p style="margin:0 0 16px 0">Your verge collection is complete. We'd love to hear how it went.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Reference</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right;font-family:'SF Mono',monospace">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap">Collection date</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#8FA5B8;font-size:13px;white-space:nowrap;vertical-align:top">Address</td><td style="padding:6px 0;color:#293F52;font-size:13px;text-align:right">${escapeHtml(address)}</td></tr>
    </table>
    <p style="margin:0 0 16px 0">Your feedback helps us improve the service for everyone.</p>
  `

  const ctaUrl = `${appUrl}/${booking.client.slug}/survey/${surveyToken}`

  return {
    subject: `How was your collection? — ${ref}`,
    html: renderEmailLayout({
      client: booking.client,
      preheader: `Your verge collection is complete — we'd love your feedback`,
      heading: 'Collection complete',
      bodyHtml,
      ctaText: 'Complete survey',
      ctaUrl,
    }),
  }
}
