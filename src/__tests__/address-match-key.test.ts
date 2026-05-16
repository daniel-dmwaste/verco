import { describe, it, expect } from 'vitest'
import {
  addressMatchKey,
  buildAddressIlikePattern,
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

describe('buildAddressIlikePattern', () => {
  // Anchoring at the start is the whole point of this helper. Regression
  // for VER-214: the previous `%{key}%` shape made "32 Lake St" match
  // "232 Lake St" because "232" contains "32".
  it('anchors the pattern at the start of formatted_address', () => {
    expect(buildAddressIlikePattern('32 Lake St, Perth WA')).toBe(
      '32 Lake St, Perth WA%'
    )
  })

  it('does NOT produce a leading wildcard (would collide on house-number substrings)', () => {
    const pattern = buildAddressIlikePattern('32 Lake St, Perth WA')
    expect(pattern.startsWith('%')).toBe(false)
  })

  it('escapes literal % so addresses with percent signs do not become wildcards', () => {
    expect(buildAddressIlikePattern('100% Pure St, Perth WA')).toBe(
      '100\\% Pure St, Perth WA%'
    )
  })

  it('escapes literal underscore (rare but possible in formatted_address)', () => {
    expect(buildAddressIlikePattern('Lot_1 X Rd, Perth')).toBe(
      'Lot\\_1 X Rd, Perth%'
    )
  })

  it('escapes backslash so an embedded backslash is literal', () => {
    expect(buildAddressIlikePattern('a\\b')).toBe('a\\\\b%')
  })

  // Simulate the actual collision against canonical formatted_address values.
  // PostgreSQL ILIKE semantics: `%` = any-N, `_` = any-one, both case-insensitive.
  function ilikeMatches(value: string, pattern: string): boolean {
    let regex = ''
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]
      if (c === '\\' && i + 1 < pattern.length) {
        const next = pattern[i + 1]
        regex += next!.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
        i++
      } else if (c === '%') {
        regex += '.*'
      } else if (c === '_') {
        regex += '.'
      } else {
        regex += c!.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
      }
    }
    return new RegExp(`^${regex}$`, 'i').test(value)
  }

  it('rejects house-number-suffix collisions (regression for VER-214)', () => {
    const pattern = buildAddressIlikePattern('32 Lake St, Perth WA')
    expect(
      ilikeMatches('32 Lake St, Perth WA 6000, Australia', pattern)
    ).toBe(true)
    expect(
      ilikeMatches('232 Lake St, Perth WA 6000, Australia', pattern)
    ).toBe(false)
    expect(
      ilikeMatches('1032 Lake St, Perth WA 6000, Australia', pattern)
    ).toBe(false)
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
