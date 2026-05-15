/**
 * Hostname helpers for the proxy's tenant-resolution branch.
 *
 * Verco's proxy resolves a tenant by reading the request `Host` header and
 * looking up a `client` row by slug or custom_domain. Two route surfaces
 * are NOT per-client and don't belong on a client subdomain:
 *
 * - `admin.verco.au` — operator surface, contractor-scoped. A contractor-admin
 *   may span multiple clients; pinning them to one client subdomain forces
 *   N tabs and fights the "view all my clients" workflow.
 * - `field.verco.au` — crew PWA, contractor-scoped. A crew dispatched by a
 *   contractor often handles stops at multiple clients in one shift; the
 *   per-client subdomain can't represent that.
 *
 * These helpers check the hostname prefix so the same code works in:
 * - production: `admin.verco.au`, `field.verco.au`
 * - dev:        `admin.localhost:3000`, `field.localhost:3000`
 *
 * Hostname rewriting (`toAdminHostname` / `toFieldHostname`) is used by
 * the proxy when 301-redirecting old `{client}.verco.au/admin/*` URLs to
 * the new dedicated host while preserving the protocol + path + query.
 */

export const ADMIN_HOSTNAME_PROD = 'admin.verco.au'
export const FIELD_HOSTNAME_PROD = 'field.verco.au'

const ADMIN_PREFIX = 'admin.'
const FIELD_PREFIX = 'field.'

export function isAdminHostname(host: string): boolean {
  return host.toLowerCase().startsWith(ADMIN_PREFIX)
}

export function isFieldHostname(host: string): boolean {
  return host.toLowerCase().startsWith(FIELD_PREFIX)
}

/**
 * Rewrite a hostname's first DNS segment so the same base-domain (and port)
 * is preserved but the discriminator changes. Used to map a client-subdomain
 * request to its admin/field counterpart for the 301 redirect.
 *
 * Examples:
 * - `vvtest.verco.au`         → `admin.verco.au`
 * - `kwntest.localhost:3000`  → `admin.localhost:3000`
 * - `localhost:3000`          → `admin.localhost:3000` (bare host gets prefix)
 */
function rewriteFirstSegment(host: string, replacement: string): string {
  if (!host.includes('.')) {
    return `${replacement}.${host}`
  }
  const parts = host.split('.')
  parts[0] = replacement
  return parts.join('.')
}

export function toAdminHostname(host: string): string {
  return rewriteFirstSegment(host, 'admin')
}

export function toFieldHostname(host: string): string {
  return rewriteFirstSegment(host, 'field')
}
