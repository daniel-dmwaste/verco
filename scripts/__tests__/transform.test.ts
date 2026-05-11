import { describe, it, expect } from 'vitest'
import { toVercoRow } from '../lib/transform'
import type { AirtableEligibleProperty, GeocodeResult } from '../lib/types'

const baseId = 'appTESTbase00000000'
const areaId = '00000000-0000-0000-0000-000000000001'

const mainRow: AirtableEligibleProperty = {
  id: 'rec00ANo7vIwiCTTo',
  address: '290 Carrington ST HILTON',
  councilCode: 'FRE-S',
  latitude: -32.0737559,
  longitude: 115.7801567,
}

const subRow: AirtableEligibleProperty = {
  id: 'rec00DIxQ0T4acSe1',
  address: '8/112 Hensman Road SUBIACO',
  councilCode: 'SUB',
  latitude: null,
  longitude: null,
}

const fakeGeocode: GeocodeResult = {
  lat: -31.9421,
  lng: 115.8267,
  placeId: 'ChIJ_test_place_id',
  formattedAddress: '8/112 Hensman Rd, Subiaco WA 6008, Australia',
}

describe('toVercoRow', () => {
  it('uses Airtable lat/lng when geocode is null (Main base case)', () => {
    const row = toVercoRow(mainRow, baseId, areaId, null)
    expect(row).toEqual({
      collection_area_id: areaId,
      address: '290 Carrington ST HILTON',
      formatted_address: '290 Carrington ST HILTON',
      latitude: -32.0737559,
      longitude: 115.7801567,
      google_place_id: null,
      has_geocode: true,
      is_mud: false,
      external_source: `airtable:${baseId}`,
      external_id: 'rec00ANo7vIwiCTTo',
    })
  })

  it('uses geocode lat/lng + formatted_address + place_id when provided (SUB/VIC case)', () => {
    const row = toVercoRow(subRow, baseId, areaId, fakeGeocode)
    expect(row.latitude).toBe(-31.9421)
    expect(row.longitude).toBe(115.8267)
    expect(row.google_place_id).toBe('ChIJ_test_place_id')
    expect(row.formatted_address).toBe('8/112 Hensman Rd, Subiaco WA 6008, Australia')
    expect(row.has_geocode).toBe(true)
  })

  it('has_geocode is false when neither geocode nor Airtable coords present', () => {
    const row = toVercoRow(subRow, baseId, areaId, null)
    expect(row.has_geocode).toBe(false)
    expect(row.latitude).toBeNull()
    expect(row.longitude).toBeNull()
    expect(row.google_place_id).toBeNull()
  })

  it('trims whitespace from address', () => {
    const messy = { ...mainRow, address: '  290 Carrington ST HILTON  ' }
    const row = toVercoRow(messy, baseId, areaId, null)
    expect(row.address).toBe('290 Carrington ST HILTON')
  })

  it('falls back to address when formatted_address from geocode is missing', () => {
    const row = toVercoRow(subRow, baseId, areaId, null)
    expect(row.formatted_address).toBe('8/112 Hensman Road SUBIACO')
  })

  it('always sets is_mud to false', () => {
    expect(toVercoRow(mainRow, baseId, areaId, null).is_mud).toBe(false)
    expect(toVercoRow(subRow, baseId, areaId, fakeGeocode).is_mud).toBe(false)
  })

  it('encodes external_source as airtable:<baseId>', () => {
    expect(toVercoRow(mainRow, baseId, areaId, null).external_source).toBe(`airtable:${baseId}`)
  })
})
