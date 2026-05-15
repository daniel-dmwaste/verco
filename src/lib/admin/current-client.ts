/**
 * "Which client is the admin user currently viewing?"
 *
 * On `admin.verco.au` the proxy does NOT do hostname→client resolution
 * (admin is contractor-scoped, not client-scoped), so the admin UI needs
 * an explicit "current client" signal. We use a host-only cookie
 * (`CURRENT_ADMIN_CLIENT_COOKIE`) written by the `<ClientSwitcher>`.
 *
 * Resolution order:
 *   1. Switcher cookie (the explicit user choice)
 *   2. x-client-id header from proxy (back-compat for client-subdomain admin
 *      while ADMIN_SUBDOMAIN_ENFORCED=false — old URLs still serve)
 *   3. User's first accessible active client (sane default for first visit)
 *
 * Defence-in-depth: every candidate ID is re-queried via the authenticated
 * client, so RLS scopes to `accessible_client_ids()`. A tampered cookie
 * pointing at a client the user doesn't have access to silently falls
 * through to step 3.
 */

import { cookies, headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const CURRENT_ADMIN_CLIENT_COOKIE = 'verco_admin_client'

export interface CurrentAdminClient {
  id: string
  slug: string
  name: string
  contractorId: string
}

export interface AccessibleAdminClient {
  id: string
  slug: string
  name: string
}

export async function getCurrentAdminClient(): Promise<CurrentAdminClient | null> {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const cookieId = cookieStore.get(CURRENT_ADMIN_CLIENT_COOKIE)?.value
  const headerId = headerStore.get('x-client-id')
  const candidateId = cookieId ?? headerId ?? null

  const supabase = await createClient()

  if (candidateId) {
    const { data } = await supabase
      .from('client')
      .select('id, slug, name, contractor_id')
      .eq('id', candidateId)
      .eq('is_active', true)
      .maybeSingle()

    if (data) {
      return {
        id: data.id,
        slug: data.slug,
        name: data.name,
        contractorId: data.contractor_id,
      }
    }
  }

  // No cookie + no header (or invalid id): default to the user's first
  // accessible active client. RLS will scope this to clients the user can see.
  const { data: first } = await supabase
    .from('client')
    .select('id, slug, name, contractor_id')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!first) return null

  return {
    id: first.id,
    slug: first.slug,
    name: first.name,
    contractorId: first.contractor_id,
  }
}

export async function getAccessibleAdminClients(): Promise<AccessibleAdminClient[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('client')
    .select('id, slug, name')
    .eq('is_active', true)
    .order('name', { ascending: true })

  return data ?? []
}
