import { describe, it, expect } from 'vitest'
import {
  addressMatchKey,
  normaliseStreetTypes,
  buildLookupCandidates,
} from '@/lib/booking/address-match-key'
import { stripAddressPrefix } from '@/lib/mud/address-strip'

describe('addressMatchKey', () => {
  it('keeps the first two comma parts of a 4-part address', () => {
    expect(
      addressMatchKey('10 Casserley Way, Orelia WA 6167, Australia')
    ).toBe('10 Casserley Way, Orelia WA 6167')
  })

  it('returns the single part when no comma', () => {
    expect(addressMatchKey('10 Casserley Way')).toBe('10 Casserley Way')
  })

  it('trims whitespace around comma parts', () => {
    expect(addressMatchKey('  10 X St ,  Como WA  ,  Australia ')).toBe(
      '10 X St, Como WA'
    )
  })
})

describe('normaliseStreetTypes', () => {
  it('abbreviates Street → St at the end of the first part', () => {
    expect(normaliseStreetTypes('10 Salvado Street, Wembley WA 6014')).toBe(
      '10 Salvado St, Wembley WA 6014'
    )
  })

  it('abbreviates Avenue → Ave', () => {
    expect(normaliseStreetTypes('15/10 Murray Avenue, Mosman Park WA')).toBe(
      '15/10 Murray Ave, Mosman Park WA'
    )
  })

  it('abbreviates Crescent → Cres when followed by a directional modifier', () => {
    expect(normaliseStreetTypes('4D Rennie Crescent North, Hilton WA')).toBe(
      '4D Rennie Cres North, Hilton WA'
    )
  })

  it('only normalises the street-TYPE word, not a street NAME that collides', () => {
    expect(normaliseStreetTypes('5/2 Court Place, Subiaco WA')).toBe(
      '5/2 Court Pl, Subiaco WA'
    )
  })

  it('leaves Way unchanged (no abbreviation mapping)', () => {
    expect(normaliseStreetTypes('10 Casserley Way, Orelia WA 6167')).toBe(
      '10 Casserley Way, Orelia WA 6167'
    )
  })

  it('handles inputs with no comma', () => {
    expect(normaliseStreetTypes('10 Salvado Street')).toBe('10 Salvado St')
  })

  it('returns the input unchanged when no street type is present', () => {
    expect(normaliseStreetTypes('10 Some Building Name, Perth')).toBe(
      '10 Some Building Name, Perth'
    )
  })
})

describe('buildLookupCandidates', () => {
  it('returns [raw] when no transform applies', () => {
    expect(
      buildLookupCandidates(
        '10 Casserley Way, Orelia WA 6167',
        stripAddressPrefix
      )
    ).toEqual(['10 Casserley Way, Orelia WA 6167'])
  })

  it('returns [raw, stripped] for MUD-prefixed inputs without abbreviable street types', () => {
    expect(
      buildLookupCandidates(
        'Unit 5 / 18 Sulphur Way, Kwinana',
        stripAddressPrefix
      )
    ).toEqual(['Unit 5 / 18 Sulphur Way, Kwinana', '18 Sulphur Way, Kwinana'])
  })

  it('returns [raw, normalised] for non-MUD inputs with abbreviable street types', () => {
    expect(
      buildLookupCandidates(
        '10 Salvado Street, Wembley WA 6014',
        stripAddressPrefix
      )
    ).toEqual([
      '10 Salvado Street, Wembley WA 6014',
      '10 Salvado St, Wembley WA 6014',
    ])
  })

  it('returns all four variants when both transforms apply', () => {
    const out = buildLookupCandidates(
      'Unit 5/18 Sulphur Road, Kwinana',
      stripAddressPrefix
    )
    expect(out[0]).toBe('Unit 5/18 Sulphur Road, Kwinana')
    expect(out).toContain('18 Sulphur Road, Kwinana')
    expect(out).toContain('Unit 5/18 Sulphur Rd, Kwinana')
    expect(out).toContain('18 Sulphur Rd, Kwinana')
  })

  it('deduplicates when transforms produce the same string', () => {
    const out = buildLookupCandidates('10 Some Way, Perth', stripAddressPrefix)
    expect(out).toEqual(['10 Some Way, Perth'])
  })
})
