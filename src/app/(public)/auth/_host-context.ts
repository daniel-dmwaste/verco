/**
 * Hostname-driven copy + post-login routing for the auth flow.
 *
 * The auth pages (entry, verify) and the callback share the same per-host
 * logic: which brand strings to show, and where to land the user after
 * verification succeeds.
 *
 * Server-side only — relies on `headers()` from `next/headers`. Client
 * components receive the resolved values as props.
 */

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isAdminHostname, isFieldHostname } from '@/lib/proxy/hostnames'

export interface AuthBrandCopy {
  serviceName: string
  contextLabel: string
}

export function postLoginPathForHost(host: string): string {
  if (isAdminHostname(host)) return '/admin'
  if (isFieldHostname(host)) return '/field'
  return '/dashboard'
}

export async function resolveAuthHostContext(): Promise<{
  brand: AuthBrandCopy
  postLoginPath: string
}> {
  const headerStore = await headers()
  const host = headerStore.get('host') ?? ''

  if (isAdminHostname(host)) {
    return {
      brand: { serviceName: 'Verco Admin', contextLabel: 'Operator sign-in' },
      postLoginPath: '/admin',
    }
  }
  if (isFieldHostname(host)) {
    return {
      brand: { serviceName: 'Verco Crew', contextLabel: 'Field sign-in' },
      postLoginPath: '/field',
    }
  }

  // Client subdomain: pull display name from the resolved tenant.
  const clientId = headerStore.get('x-client-id')
  let brand: AuthBrandCopy = { serviceName: 'Verge Collection', contextLabel: '' }

  if (clientId) {
    const supabase = await createClient()
    const { data: client } = await supabase
      .from('client')
      .select('name, service_name')
      .eq('id', clientId)
      .single()
    if (client) {
      brand = {
        serviceName: client.service_name ?? 'Verge Collection',
        contextLabel: client.name,
      }
    }
  }

  return { brand, postLoginPath: '/dashboard' }
}
