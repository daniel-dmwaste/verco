import { createClient } from '@/lib/supabase/server'
import { RunSheetClient } from './run-sheet-client'

export default async function RunSheetPage() {
  const supabase = await createClient()

  const today = new Date().toISOString().split('T')[0]

  // Fetch today's scheduled bookings — NO PII fields. Structural exclusion.
  // Never select contacts.full_name, contacts.email, contacts.mobile_e164
  const { data: bookings } = await supabase
    .from('booking')
    .select(
      `id, ref, status, type, location, notes, latitude, longitude,
       collection_area!inner(name, code),
       eligible_properties:property_id(address, formatted_address, latitude, longitude),
       booking_item(
         id, no_services, is_extra, unit_price_cents, actual_services,
         service!inner(name),
         collection_date!inner(date)
       )`
    )
    .in('status', ['Scheduled', 'Completed', 'Non-conformance', 'Nothing Presented'])
    .order('created_at', { ascending: true })

  // Filter to today's collection date
  type BookingRow = NonNullable<typeof bookings>[number]
  const todaysBookings = (bookings ?? []).filter((b: BookingRow) => {
    const items = b.booking_item as Array<{ collection_date: { date: string } }>
    return items.some((item) => item.collection_date.date === today)
  })

  return <RunSheetClient bookings={todaysBookings} />
}
