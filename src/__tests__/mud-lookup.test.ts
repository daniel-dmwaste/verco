import { describe, it, expect } from 'vitest'
import { decideMudRedirect, type MudLookupCandidate } from '@/lib/mud/mud-lookup'

const mud = (over: Partial<MudLookupCandidate> = {}): MudLookupCandidate => ({
  id: 'mud-1',
  formatted_address: '123 Broome St, Cottesloe',
  address: '123 Broome St',
  is_mud: true,
  is_eligible: true,
  ...over,
})

const sud = (over: Partial<MudLookupCandidate> = {}): MudLookupCandidate => ({
  id: 'sud-1',
  formatted_address: '45 Smith St, Cottesloe',
  address: '45 Smith St',
  is_mud: false,
  is_eligible: true,
  ...over,
})

describe('decideMudRedirect', () => {
  it('no candidates → no redirect', () => {
    const r = decideMudRedirect([])
    expect(r.redirect).toBe(false)
    expect(r.building_address).toBeNull()
    expect(r.property_id).toBeNull()
  })

  it('only SUD candidates → no redirect', () => {
    const r = decideMudRedirect([sud(), sud({ id: 'sud-2' })])
    expect(r.redirect).toBe(false)
  })

  it('one MUD candidate → redirect with formatted address', () => {
    const r = decideMudRedirect([mud()])
    expect(r.redirect).toBe(true)
    expect(r.building_address).toBe('123 Broome St, Cottesloe')
    expect(r.property_id).toBe('mud-1')
  })

  it('mixed SUDs and MUDs → redirect (MUD wins)', () => {
    const r = decideMudRedirect([sud(), mud()])
    expect(r.redirect).toBe(true)
    expect(r.property_id).toBe('mud-1')
  })

  it('falls back to address when formatted_address is null', () => {
    const r = decideMudRedirect([mud({ formatted_address: null })])
    expect(r.building_address).toBe('123 Broome St')
  })
})
