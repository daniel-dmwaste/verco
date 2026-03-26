import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/supabase/types'

type ClientRow = Database['public']['Tables']['client']['Row']
type ContractorRow = Database['public']['Tables']['contractor']['Row']

export type ResolvedClient = ClientRow & {
  contractor: ContractorRow
}

/**
 * Resolve a client (tenant) from the request hostname.
 * Matches on subdomain slug OR custom_domain. Returns null if no active match.
 */
export async function resolveClient(hostname: string): Promise<ResolvedClient | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll can throw in middleware/server component contexts
          }
        },
      },
    }
  )

  // Extract subdomain: "kwn.verco.au" → "kwn", "localhost:3000" → "localhost"
  const slug = hostname.split('.')[0]

  const { data } = await supabase
    .from('client')
    .select('*, contractor!inner(*)')
    .or(`slug.eq.${slug},custom_domain.eq.${hostname}`)
    .eq('is_active', true)
    .single()

  if (!data) return null

  return data as ResolvedClient
}
