import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { PublicNav } from '@/components/public/public-nav'
import { MobileFab } from '@/components/public/mobile-fab'
import { MobileBottomNav } from '@/components/public/mobile-bottom-nav'

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

const STAFF_ROLES = ['contractor-admin', 'contractor-staff', 'client-admin', 'client-staff']

async function getIsStaff(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    return STAFF_ROLES.includes(userRole?.role ?? '')
  } catch {
    return false
  }
}

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [branding, isStaff] = await Promise.all([
    getClientBranding(),
    getIsStaff(),
  ])
  const primaryColour = branding?.primary_colour ?? '#293F52'

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={
        { '--color-primary': primaryColour } as React.CSSProperties
      }
    >
      <PublicNav
        serviceName={branding?.service_name ?? 'Verge Collection'}
        logoUrl={branding?.logo_light_url ?? null}
        showPoweredBy={branding?.show_powered_by ?? true}
        showAdminLink={isStaff}
      />
      <div className="pb-16 tablet:pb-0">
        {children}
      </div>
      <MobileFab />
      <MobileBottomNav showAdminLink={isStaff} />
    </div>
  )
}
