import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FieldLayoutClient } from './field-layout-client'

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth')
  }

  // Get user role — structural check, field/ranger only
  const { data: role } = await supabase.rpc('current_user_role')

  if (!role || !['field', 'ranger'].includes(role)) {
    redirect('/auth')
  }

  const roleLabel = role === 'ranger' ? 'Ranger' : 'Field Staff'

  // Get accessible collection area codes for header display
  const { data: areas } = await supabase
    .from('collection_area')
    .select('code')
    .eq('is_active', true)
    .order('code')

  const areaCodes = (areas ?? []).map((a) => a.code).join(' · ')

  return (
    <FieldLayoutClient roleLabel={roleLabel} areaCodes={areaCodes}>
      {children}
    </FieldLayoutClient>
  )
}
