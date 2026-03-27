import type { BookingItem } from './schemas'

/**
 * Encode booking items into a URL-safe string for search params.
 * Format: service_id:qty pairs, comma-separated.
 */
export function encodeItems(items: BookingItem[]): string {
  return items
    .filter((item) => item.no_services > 0)
    .map((item) => `${item.service_id}:${item.no_services}`)
    .join(',')
}

/**
 * Decode booking items string back to a map of service_id → quantity.
 */
export function decodeItems(
  encoded: string
): Map<string, number> {
  const map = new Map<string, number>()
  if (!encoded) return map
  for (const pair of encoded.split(',')) {
    const [id, qtyStr] = pair.split(':')
    if (id && qtyStr) {
      const qty = parseInt(qtyStr, 10)
      if (!isNaN(qty) && qty > 0) {
        map.set(id, qty)
      }
    }
  }
  return map
}
