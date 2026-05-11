import type { GeocodeResult } from './types'

type GeocodeOptions = {
  /** Initial backoff delay in milliseconds. Defaults to 200. */
  initialDelayMs?: number
  /** Max retries on OVER_QUERY_LIMIT. Defaults to 4. */
  maxRetries?: number
  /** AU region bias. Defaults to true. */
  biasAu?: boolean
}

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json'

/**
 * Call Google's Geocoding API for one address.
 *
 *   • Returns a GeocodeResult on OK with at least one result.
 *   • Returns null on ZERO_RESULTS (soft failure — caller continues).
 *   • Returns null after maxRetries+1 attempts on OVER_QUERY_LIMIT.
 *   • Throws on HTTP error (5xx, network failure, malformed response).
 *
 * Caller controls QPS via the surrounding loop; this function does not
 * rate-limit itself beyond per-call retry backoff.
 */
export async function geocodeAddress(
  address: string,
  apiKey: string,
  opts: GeocodeOptions = {},
): Promise<GeocodeResult | null> {
  const initialDelayMs = opts.initialDelayMs ?? 200
  const maxRetries = opts.maxRetries ?? 4
  const biasAu = opts.biasAu ?? true

  const params = new URLSearchParams({ address, key: apiKey })
  if (biasAu) params.set('region', 'au')
  // URLSearchParams encodes spaces as '+' (form-encoding); normalise to '%20'
  // so the URL matches RFC 3986 query-string conventions.
  const url = `${ENDPOINT}?${params.toString().replace(/\+/g, '%20')}`

  let attempt = 0
  let delay = initialDelayMs
  while (true) {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Geocoding API HTTP ${res.status}`)
    }
    const body = (await res.json()) as {
      status: string
      results: Array<{
        geometry: { location: { lat: number; lng: number } }
        place_id: string
        formatted_address: string
      }>
    }

    if (body.status === 'OK' && body.results.length > 0) {
      const top = body.results[0]!
      return {
        lat: top.geometry.location.lat,
        lng: top.geometry.location.lng,
        placeId: top.place_id,
        formattedAddress: top.formatted_address,
      }
    }
    if (body.status === 'ZERO_RESULTS') return null
    if (body.status === 'OVER_QUERY_LIMIT' && attempt < maxRetries) {
      await sleep(delay)
      attempt++
      delay *= 2
      continue
    }
    // Persistent OVER_QUERY_LIMIT, INVALID_REQUEST, REQUEST_DENIED, UNKNOWN_ERROR — soft fail
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
