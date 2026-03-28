import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BookingDetailClient } from './booking-detail-client'

interface BookingDetailPageProps {
  params: Promise<{ ref: string }>
}

export default async function BookingDetailPage({
  params,
}: BookingDetailPageProps) {
  const { ref } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth')
  }

  // RLS ensures this only returns if the booking belongs to the current user
  const { data: booking } = await supabase
    .from('booking')
    .select(
      `
      id,
      ref,
      status,
      type,
      location,
      notes,
      created_at,
      collection_area!inner(name),
      booking_item(
        id,
        no_services,
        is_extra,
        unit_price_cents,
        service!inner(name),
        collection_date!inner(date)
      )
    `
    )
    .eq('ref', ref)
    .single()

  if (!booking) {
    redirect('/dashboard')
  }

  // Fetch service tickets linked to this booking (RLS scopes to resident's own)
  const { data: tickets } = await supabase
    .from('service_ticket')
    .select('id, display_id, subject, status, category, created_at')
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false })

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <BookingDetailClient booking={booking} tickets={tickets ?? []} />
    </main>
  )
}
