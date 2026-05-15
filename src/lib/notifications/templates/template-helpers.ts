export function formatCurrency(cents: number): string {
  const dollars = cents / 100
  return dollars.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
  })
}

export function formatCollectionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00+08:00`)
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  })
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Build a resolvable booking-portal URL for an email CTA.
 *
 * Verco uses **hostname-based tenant routing** — every client has its own
 * subdomain (`vvtest.verco.au`, `kwntest.verco.au`, …). Concatenating
 * `${appUrl}/${slug}/...` produces a broken link because `verco.au` doesn't
 * have a `/vergevalet/` path route. The proper booking-detail URL is
 * `https://<client-hostname>/booking/<ref>`.
 *
 * Resolution order:
 *   1. `client.custom_domain` if set (the actual prod / UAT host)
 *   2. `https://{slug}.verco.au` (works once DNS is wildcard-set for slugs)
 *   3. `appUrl + path` as a last-resort fallback (better than nothing)
 *
 * @param client  BookingClientForDispatch row from the dispatcher
 * @param path    URL path including leading slash (e.g. `/booking/ABC123`)
 * @param appUrl  Final fallback when neither custom_domain nor slug yield
 *                a working host (shouldn't happen for active clients).
 */
export function buildBookingPortalUrl(
  client: { slug: string; custom_domain: string | null },
  path: string,
  appUrl: string,
): string {
  if (client.custom_domain) {
    return `https://${client.custom_domain}${path}`
  }
  if (client.slug) {
    return `https://${client.slug}.verco.au${path}`
  }
  return `${appUrl}${path}`
}
