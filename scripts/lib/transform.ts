import type {
  AirtableEligibleProperty,
  EligiblePropertyInsert,
  GeocodeResult,
} from './types'

/**
 * Transform one Airtable row into a Verco eligible_properties INSERT.
 *
 * Pure function — no I/O. The caller is responsible for resolving the
 * Council_Code → areaId mapping and (for SUB/VIC) running the geocode
 * lookup before calling.
 *
 * Behaviour:
 *   • For Main-base rows, pass geocode=null and lat/lng come from Airtable.
 *   • For SUB/VIC rows that geocoded successfully, pass the GeocodeResult.
 *   • For SUB/VIC rows that failed to geocode, pass geocode=null — the row
 *     still gets inserted, but with null lat/lng and has_geocode=false.
 */
export function toVercoRow(
  airtable: AirtableEligibleProperty, // .latitude/.longitude exist only on Main base rows
  baseId: string,
  areaId: string,
  geocode: GeocodeResult | null,      // null for Main rows + for SUB/VIC soft-failures
): EligiblePropertyInsert {
  const address = airtable.address.trim()
  const lat = geocode?.lat ?? airtable.latitude ?? null
  const lng = geocode?.lng ?? airtable.longitude ?? null
  const hasGeocode = lat !== null && lng !== null

  return {
    collection_area_id: areaId,
    address,
    formatted_address: geocode?.formattedAddress ?? address,
    latitude: lat,
    longitude: lng,
    google_place_id: geocode?.placeId ?? null,
    has_geocode: hasGeocode,
    is_mud: false,
    external_source: `airtable:${baseId}`,
    external_id: airtable.id,
  }
}
