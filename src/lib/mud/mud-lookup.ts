/**
 * MUD lookup decision helper — pure logic, no DB calls.
 *
 * The DB query lives in the caller (Flow 5 address-form integration in D3).
 * This module decides what to render based on the query result.
 *
 * Two redirect outcomes:
 *   1. Match found AND is_mud=true → block resident, render redirect message
 *   2. Match found AND is_mud=false → proceed (SUD pass-through)
 *   3. No match → proceed (resident enters details normally)
 */

import { stripAddressPrefix } from './address-strip'

/** Minimal shape of an eligible_properties row needed for the lookup decision. */
export interface MudLookupCandidate {
  id: string
  formatted_address: string | null
  address: string
  is_mud: boolean
  is_eligible: boolean
}

export interface MudRedirectDecision {
  /** True when the booking flow should be blocked and the redirect shown. */
  redirect: boolean
  /** Building address to display in the redirect message. */
  building_address: string | null
  /** ID of the matched MUD property (for analytics if needed). */
  property_id: string | null
}

/**
 * Decides whether a resident's address resolves to an MUD that should block
 * individual booking.
 *
 * The caller is expected to:
 *   1. Take the resident's input or Google Places formatted_address
 *   2. Call stripAddressPrefix() to remove any "Unit X / " prefix
 *   3. Query eligible_properties for matches scoped to the client
 *   4. Pass the candidate(s) here
 *
 * Returns redirect=true ONLY when the strongest match is is_mud=true.
 */
export function decideMudRedirect(
  candidates: MudLookupCandidate[]
): MudRedirectDecision {
  if (candidates.length === 0) {
    return { redirect: false, building_address: null, property_id: null }
  }

  const mud = candidates.find((c) => c.is_mud)
  if (!mud) {
    return { redirect: false, building_address: null, property_id: null }
  }

  return {
    redirect: true,
    building_address: mud.formatted_address ?? mud.address,
    property_id: mud.id,
  }
}

/**
 * Convenience: combine the strip + decision into a single call. Caller still
 * does the DB lookup between the two steps. Re-exported for tests.
 */
export { stripAddressPrefix }
