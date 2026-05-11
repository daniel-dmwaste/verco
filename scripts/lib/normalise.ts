/**
 * Normalise an address for duplicate detection.
 *
 * Aggressive enough to catch "290 Carrington St Hilton WA 6163" and
 * "290 Carrington ST HILTON" as the same address. Unit numbers
 * (e.g. "21/94") are preserved.
 *
 * NOT for display — only for dedup keys.
 */
export function normaliseAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(wa|western australia)\b\s*\d{4}?/gi, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
