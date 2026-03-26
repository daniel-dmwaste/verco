import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

serve(async (req) => {
  // Admin-only: require service role key via Authorization header
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Use service role to bypass RLS — this is an admin batch operation
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Google Places API key not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Fetch all un-geocoded properties
  const { data: properties, error: fetchError } = await supabase
    .from('eligible_properties')
    .select('id, address, formatted_address')
    .eq('has_geocode', false)
    .order('created_at', { ascending: true })

  if (fetchError) {
    return new Response(
      JSON.stringify({ error: fetchError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!properties || properties.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No un-geocoded properties found', processed: 0 }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  const BATCH_SIZE = 10
  const DELAY_MS = 100
  let processed = 0
  let failed = 0
  const errors: Array<{ id: string; error: string }> = []

  for (let i = 0; i < properties.length; i += BATCH_SIZE) {
    const batch = properties.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async (prop) => {
        const address = prop.formatted_address ?? prop.address
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
        url.searchParams.set('address', address)
        url.searchParams.set('key', apiKey)
        url.searchParams.set('components', 'country:AU')

        try {
          const res = await fetch(url.toString())
          const data = await res.json()

          if (data.status !== 'OK' || !data.results?.[0]) {
            return { id: prop.id, success: false, error: `Geocode status: ${data.status}` }
          }

          const result = data.results[0]
          const location = result.geometry.location as { lat: number; lng: number }
          const placeId = result.place_id as string

          const { error: updateError } = await supabase
            .from('eligible_properties')
            .update({
              latitude: location.lat,
              longitude: location.lng,
              google_place_id: placeId,
              has_geocode: true,
            })
            .eq('id', prop.id)

          if (updateError) {
            return { id: prop.id, success: false, error: updateError.message }
          }

          return { id: prop.id, success: true }
        } catch (err) {
          return { id: prop.id, success: false, error: String(err) }
        }
      })
    )

    for (const r of results) {
      if (r.success) {
        processed++
      } else {
        failed++
        errors.push({ id: r.id, error: r.error ?? 'Unknown error' })
      }
    }

    // Rate limit delay between batches
    if (i + BATCH_SIZE < properties.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    }
  }

  return new Response(
    JSON.stringify({
      message: `Geocoding complete. ${processed} processed, ${failed} failed.`,
      total: properties.length,
      processed,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
