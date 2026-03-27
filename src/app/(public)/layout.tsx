import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { PublicNav } from '@/components/public/public-nav'

interface ClientBranding {
  name: string
  slug: string
  logo_light_url: string | null
  primary_colour: string | null
  service_name: string | null
  show_powered_by: boolean
}

async function getClientBranding(): Promise<ClientBranding | null> {
  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')

  if (!clientId) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('client')
    .select('name, slug, logo_light_url, primary_colour, service_name, show_powered_by')
    .eq('id', clientId)
    .single()

  return data
}

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getClientBranding()
  const primaryColour = branding?.primary_colour ?? '#293F52'

  return (
    <div
      style={
        { '--color-primary': primaryColour } as React.CSSProperties
      }
    >
      <PublicNav
        serviceName={branding?.service_name ?? 'Verge Collection'}
        logoUrl={branding?.logo_light_url ?? null}
        showPoweredBy={branding?.show_powered_by ?? true}
      />
      {children}
    </div>
  )
}
