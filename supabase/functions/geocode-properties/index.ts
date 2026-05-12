import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

type RequestBody = {
  // Cap the number of rows processed in one invocation. Default: all matching.
  // Useful for chunking large backfills under the 150s EF wall-clock limit.
  limit?: number
  // Skip the UPDATE — emit what would have been written. For smoke testing.
  dry_run?: boolean
  // Also call Places Autocomplete with the same address and compare place_ids.
  // Validates that Geocoding API and Places Autocomplete agree on the place_id
  // for an address before we commit a bulk re-geocode.
  compare_autocomplete?: boolean
  // Restrict to a single external_source — used to stratify smoke tests
  // across import sources (Main/SUB/VIC). Default: all sources.
  external_source?: string
}

type GeocodeOutcome =
  | {
      id: string
      success: true
      placeId: string
      latitude: number
      longitude: number
      googleFormattedAddress: string
      autocompletePlaceId: string | null
      autocompleteDescription: string | null
      autocompleteStatus: string
    }
  | { id: string; success: false; error: string }

serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 })
  }

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

  let body: RequestBody = {}
  try {
    body = await req.json()
  } catch {
    // Empty/invalid body is fine — all params are optional.
  }
  const limit =
    typeof body.limit === 'number' ? Math.max(1, Math.min(body.limit, 50_000)) : null
  const dryRun = body.dry_run === true
  const compareAutocomplete = body.compare_autocomplete === true
  const externalSource = typeof body.external_source === 'string' ? body.external_source : null

  // Catches rows missing place_id regardless of has_geocode state. The Main VV
  // import populated lat/long from Airtable without calling Geocoding, so
  // ~66K rows have has_geocode=true but google_place_id=null — and the
  // booking autocomplete primary-path lookup is keyed on google_place_id.
  let query = supabase
    .from('eligible_properties')
    .select('id, address, formatted_address, external_source')
    .is('google_place_id', null)
    .order('created_at', { ascending: true })

  if (externalSource) query = query.eq('external_source', externalSource)

  // For smoke tests with compareAutocomplete: oversample then shuffle so the
  // 50-row sample spans Main/SUB/VIC by chance rather than all-from-oldest.
  const oversample = compareAutocomplete && limit ? Math.min(limit * 5, 50_000) : limit
  if (oversample) query = query.limit(oversample)

  const { data: fetched, error: fetchError } = await query
  if (fetchError) {
    return new Response(
      JSON.stringify({ error: fetchError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
  if (!fetched || fetched.length === 0) {
    // `failed: 0` keeps the response shape stable so the chunked-loop runner's
    // parseEfResponse() recognises this as a clean done-signal, not a malformed
    // envelope (which would trip the consecutive-failures abort path).
    return new Response(
      JSON.stringify({
        message: 'No properties missing google_place_id',
        processed: 0,
        total: 0,
        failed: 0,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  const properties =
    compareAutocomplete && limit ? shuffle(fetched).slice(0, limit) : fetched

  const BATCH_SIZE = 10
  const DELAY_MS = 100
  let processed = 0
  let failed = 0
  const errors: Array<{ id: string; error: string }> = []
  const parity: Array<{
    id: string
    address: string
    external_source: string | null
    geocode_place_id: string
    geocode_formatted_address: string
    autocomplete_place_id: string | null
    autocomplete_description: string | null
    autocomplete_status: string
    match: boolean
  }> = []

  for (let i = 0; i < properties.length; i += BATCH_SIZE) {
    const batch = properties.slice(i, i + BATCH_SIZE)

    const results: GeocodeOutcome[] = await Promise.all(
      batch.map(async (prop): Promise<GeocodeOutcome> => {
        const address = prop.formatted_address ?? prop.address
        try {
          const geoUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json')
          geoUrl.searchParams.set('address', address)
          geoUrl.searchParams.set('key', apiKey)
          geoUrl.searchParams.set('components', 'country:AU')

          const geoRes = await fetch(geoUrl.toString())
          const geoData = await geoRes.json()
          if (geoData.status !== 'OK' || !geoData.results?.[0]) {
            return {
              id: prop.id,
              success: false,
              error: `Geocode: ${geoData.status}${
                geoData.error_message ? ` (${geoData.error_message})` : ''
              }`,
            }
          }
          const result = geoData.results[0]
          const location = result.geometry.location as { lat: number; lng: number }
          const placeId = result.place_id as string
          // Strip Geocoding's premise prefix ("Unit 18/346 ..." → "18/346 ...").
          // The autocomplete description never has these, so the ILIKE fallback
          // would miss without normalising one side.
          const googleFormattedAddress = stripPremisePrefix(
            result.formatted_address as string
          )

          let autocompletePlaceId: string | null = null
          let autocompleteDescription: string | null = null
          let autocompleteStatus = 'SKIPPED'
          if (compareAutocomplete) {
            const acUrl = new URL(
              'https://maps.googleapis.com/maps/api/place/autocomplete/json'
            )
            acUrl.searchParams.set('input', address)
            acUrl.searchParams.set('key', apiKey)
            acUrl.searchParams.set('components', 'country:au')
            const acRes = await fetch(acUrl.toString())
            const acData = await acRes.json()
            autocompleteStatus = acData.status ?? 'UNKNOWN'
            autocompletePlaceId = acData.predictions?.[0]?.place_id ?? null
            autocompleteDescription = acData.predictions?.[0]?.description ?? null
          }

          if (!dryRun) {
            // Overwrite formatted_address with Google's canonical form. The
            // booking-flow ILIKE fallback ([address-form.tsx]:64-88) reduces
            // the resident's typed address to its first two comma parts and
            // substring-matches against formatted_address — that only works
            // when both sides are in the same canonical format.
            const { error: updateError } = await supabase
              .from('eligible_properties')
              .update({
                latitude: location.lat,
                longitude: location.lng,
                google_place_id: placeId,
                formatted_address: googleFormattedAddress,
                has_geocode: true,
              })
              .eq('id', prop.id)
            if (updateError) {
              return { id: prop.id, success: false, error: updateError.message }
            }
          }

          return {
            id: prop.id,
            success: true,
            placeId,
            latitude: location.lat,
            longitude: location.lng,
            googleFormattedAddress,
            autocompletePlaceId,
            autocompleteDescription,
            autocompleteStatus,
          }
        } catch (err) {
          return {
            id: prop.id,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      })
    )

    for (let j = 0; j < results.length; j++) {
      const r = results[j]!
      const prop = batch[j]!
      if (r.success) {
        processed++
        if (compareAutocomplete) {
          parity.push({
            id: r.id,
            address: prop.formatted_address ?? prop.address,
            external_source: prop.external_source,
            geocode_place_id: r.placeId,
            geocode_formatted_address: r.googleFormattedAddress,
            autocomplete_place_id: r.autocompletePlaceId,
            autocomplete_description: r.autocompleteDescription,
            autocomplete_status: r.autocompleteStatus,
            match: r.autocompletePlaceId === r.placeId,
          })
        }
      } else {
        failed++
        errors.push({ id: r.id, error: r.error })
      }
    }

    if (i + BATCH_SIZE < properties.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    }
  }

  const response: Record<string, unknown> = {
    message: `${dryRun ? 'DRY RUN — ' : ''}Geocoding complete. ${processed} succeeded${
      dryRun ? ' (no writes)' : ' (written)'
    }, ${failed} failed.`,
    total: properties.length,
    processed,
    failed,
    dry_run: dryRun,
  }
  if (errors.length > 0) response.errors = errors.slice(0, 20)
  if (compareAutocomplete) {
    const matches = parity.filter((p) => p.match).length
    const bySource: Record<string, { total: number; matches: number }> = {}
    for (const p of parity) {
      const key = p.external_source ?? '(null)'
      bySource[key] ??= { total: 0, matches: 0 }
      bySource[key].total++
      if (p.match) bySource[key].matches++
    }
    response.parity = {
      sample_size: parity.length,
      matches,
      mismatches: parity.length - matches,
      match_rate_pct:
        parity.length > 0 ? Math.round((1000 * matches) / parity.length) / 10 : 0,
      by_source: bySource,
      all_samples: parity,
    }
  }

  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function stripPremisePrefix(s: string): string {
  return s.replace(/^(Unit|Flat|Townhouse|Apartment|Suite|Apt) +/i, '')
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
