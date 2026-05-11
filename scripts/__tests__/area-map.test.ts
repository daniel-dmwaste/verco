import { describe, it, expect } from 'vitest'
import { resolveAreaId, type AreaMap } from '../lib/area-map'

const map: AreaMap = new Map([
  ['COT', 'uuid-cot'],
  ['VIN', 'uuid-vin'],
  ['CAM-A', 'uuid-cam-a'],
  ['CAM-B', 'uuid-cam-b'],
  ['FRE-N', 'uuid-fre-n'],
  ['FRE-S', 'uuid-fre-s'],
])

describe('resolveAreaId', () => {
  it('resolves a direct code', () => {
    expect(resolveAreaId('COT', map)).toBe('uuid-cot')
  })

  it('resolves split-area codes directly', () => {
    expect(resolveAreaId('CAM-A', map)).toBe('uuid-cam-a')
    expect(resolveAreaId('FRE-S', map)).toBe('uuid-fre-s')
  })

  it('collapses legacy VIN-B to VIN', () => {
    expect(resolveAreaId('VIN-B', map)).toBe('uuid-vin')
  })

  it('collapses legacy VIN-G to VIN', () => {
    expect(resolveAreaId('VIN-G', map)).toBe('uuid-vin')
  })

  it('returns null for unknown code', () => {
    expect(resolveAreaId('FOO', map)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(resolveAreaId('', map)).toBeNull()
  })
})
