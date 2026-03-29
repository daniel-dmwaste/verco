import { describe, it, expect } from 'vitest'
import { encodeItems, decodeItems } from '@/lib/booking/search-params'
import type { BookingItem } from '@/lib/booking/schemas'

// Helper to build a minimal BookingItem
function item(overrides: Partial<BookingItem> & { service_id: string; no_services: number }): BookingItem {
  return {
    service_name: 'Test',
    category_name: 'Bulk',
    code: 'bulk',
    free_units: 0,
    paid_units: 0,
    unit_price_cents: 0,
    line_charge_cents: 0,
    ...overrides,
  }
}

describe('encodeItems', () => {
  it('encodes a single item', () => {
    const result = encodeItems([item({ service_id: 'svc-1', no_services: 2 })])
    expect(result).toBe('svc-1:2')
  })

  it('encodes multiple items', () => {
    const result = encodeItems([
      item({ service_id: 'svc-1', no_services: 2 }),
      item({ service_id: 'svc-2', no_services: 3 }),
    ])
    expect(result).toBe('svc-1:2,svc-2:3')
  })

  it('filters out items with no_services = 0', () => {
    const result = encodeItems([
      item({ service_id: 'svc-1', no_services: 2 }),
      item({ service_id: 'svc-2', no_services: 0 }),
    ])
    expect(result).toBe('svc-1:2')
  })

  it('returns empty string for empty array', () => {
    expect(encodeItems([])).toBe('')
  })
})

describe('decodeItems', () => {
  it('decodes a single pair', () => {
    const map = decodeItems('svc-1:2')
    expect(map.get('svc-1')).toBe(2)
    expect(map.size).toBe(1)
  })

  it('decodes multiple pairs', () => {
    const map = decodeItems('svc-1:2,svc-2:3')
    expect(map.get('svc-1')).toBe(2)
    expect(map.get('svc-2')).toBe(3)
    expect(map.size).toBe(2)
  })

  it('returns empty Map for empty string', () => {
    expect(decodeItems('').size).toBe(0)
  })

  it('skips malformed pairs', () => {
    const map = decodeItems('svc-1:2,badpair,svc-2:3')
    expect(map.size).toBe(2)
    expect(map.has('badpair')).toBe(false)
  })

  it('skips non-numeric quantity', () => {
    const map = decodeItems('svc-1:abc')
    expect(map.size).toBe(0)
  })

  it('skips zero and negative quantities', () => {
    const map = decodeItems('svc-1:0,svc-2:-1')
    expect(map.size).toBe(0)
  })

  it('roundtrip: encode then decode preserves data', () => {
    const items = [
      item({ service_id: 'svc-a', no_services: 5 }),
      item({ service_id: 'svc-b', no_services: 1 }),
    ]
    const encoded = encodeItems(items)
    const decoded = decodeItems(encoded)
    expect(decoded.get('svc-a')).toBe(5)
    expect(decoded.get('svc-b')).toBe(1)
    expect(decoded.size).toBe(2)
  })
})
