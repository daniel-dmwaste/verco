import { describe, it, expect } from 'vitest'
import { normaliseAddress } from '../lib/normalise'

describe('normaliseAddress', () => {
  it('lowercases the address', () => {
    expect(normaliseAddress('290 Carrington ST HILTON')).toBe('290 carrington st hilton')
  })

  it('strips trailing state + postcode', () => {
    expect(normaliseAddress('290 Carrington St Hilton WA 6163')).toBe('290 carrington st hilton')
  })

  it('strips "Western Australia" + postcode', () => {
    expect(normaliseAddress('14 Smith Rd Subiaco Western Australia 6008')).toBe('14 smith rd subiaco')
  })

  it('collapses multiple whitespace to single space', () => {
    expect(normaliseAddress('  290  Carrington   ST   HILTON  ')).toBe('290 carrington st hilton')
  })

  it('replaces commas with spaces then collapses', () => {
    expect(normaliseAddress('21/94 Marine Parade, COTTESLOE, WA 6011')).toBe('21/94 marine parade cottesloe')
  })

  it('preserves unit numbers separated by slash', () => {
    expect(normaliseAddress('21/94 Marine Parade')).toBe('21/94 marine parade')
  })

  it('returns empty string for empty input', () => {
    expect(normaliseAddress('')).toBe('')
  })
})
