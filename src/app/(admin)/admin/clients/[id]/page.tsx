import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ClientDetail } from './client-detail'

interface ClientDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: client } = await supabase
    .from('client')
    .select('*')
    .eq('id', id)
    .single()

  if (!client) redirect('/admin/clients')

  // Preload sub-clients for Sub-Clients + Collection Areas tabs
  const { data: subClients } = await supabase
    .from('sub_client')
    .select('id, name, code, is_active')
    .eq('client_id', id)
    .order('code')

  // Preload categories + services for Collection Areas rules config
  const [categoriesResult, servicesResult] = await Promise.all([
    supabase.from('category').select('id, name, code').order('name'),
    supabase.from('service').select('id, name, category_id').order('name'),
  ])

  return (
    <ClientDetail
      client={client}
      subClients={subClients ?? []}
      categories={categoriesResult.data ?? []}
      services={servicesResult.data ?? []}
    />
  )
}
