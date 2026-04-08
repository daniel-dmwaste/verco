/**
 * MUD capacity decision helpers — pure logic, no DB calls.
 *
 * The actual capacity counter mutation lives inside the
 * create_booking_with_capacity_check Postgres RPC (atomic, advisory-locked).
 * This module is for pre-flight UI checks: given the current state of a
 * collection_date row, decide whether the requested service can still fit.
 *
 * Capacity buckets: bulk, anc (ancillary), id (illegal dumping). Each bucket
 * has a separate _units_booked / _capacity_limit / _is_closed triple on
 * collection_date.
 *
 * MUDs increment by 2 placeholder units per service per booking (per the
 * brief Flow 2 step 5). The actual bin count post-collection lives in
 * booking_item.actual_services and is NOT reconciled to the capacity counter
 * (Watchpoint 3 in the brief).
 */

export type CapacityBucket = 'bulk' | 'anc' | 'id'

/** Per-bucket capacity slice from a collection_date row. */
export interface BucketCapacity {
  units_booked: number
  capacity_limit: number
  is_closed: boolean
}

/** A collection_date row's three buckets. */
export interface CollectionDateCapacity {
  for_mud: boolean
  bulk: BucketCapacity
  anc: BucketCapacity
  id: BucketCapacity
}

/** Per-service placeholder units added at booking time. */
export const MUD_UNITS_PER_SERVICE = 2

export interface BucketCheckResult {
  bucket: CapacityBucket
  remaining: number
  closed: boolean
  ok: boolean
}

/**
 * Returns whether a collection_date can accept `units` more in the given bucket.
 * Closed buckets always return ok=false regardless of remaining capacity.
 */
export function checkBucketCapacity(
  bucket: BucketCapacity,
  bucketName: CapacityBucket,
  units: number
): BucketCheckResult {
  const remaining = bucket.capacity_limit - bucket.units_booked
  const closed = bucket.is_closed
  const ok = !closed && remaining >= units
  return { bucket: bucketName, remaining, closed, ok }
}

/**
 * Returns whether a collection_date is bookable for MUD usage at all
 * (i.e. for_mud=true). Use as the first filter in the date picker query.
 */
export function isMudCollectionDate(date: { for_mud: boolean }): boolean {
  return date.for_mud === true
}

/**
 * Computes the new units_booked value after adding the placeholder units for
 * a MUD booking. Caller is responsible for actually persisting this — this
 * function exists for testability of the increment math.
 */
export function incrementBucketUnits(currentBooked: number, servicesInBucket: number): number {
  return currentBooked + servicesInBucket * MUD_UNITS_PER_SERVICE
}
