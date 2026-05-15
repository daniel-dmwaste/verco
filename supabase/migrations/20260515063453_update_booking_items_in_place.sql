-- update_booking_items_in_place — atomic in-place update of a booking's
-- services + collection date + metadata, preserving the booking row (same
-- id, same ref, same audit lineage on `booking`).
--
-- Existing behaviour was to cancel the old booking and create a new one
-- via create_booking_with_capacity_check (handled application-side by
-- replaceBookingAfterEdit). That worked but:
--   - Generated a fresh ref every edit (CAM-A-XXX → CAM-A-YYY)
--   - Fragmented audit history across multiple booking rows
--   - Cluttered the bookings list with cancelled-and-replaced entries
--
-- The right architecture: keep the booking row, atomically swap items.
-- Capacity counters self-maintain via the recalculate_units AFTER
-- INSERT/UPDATE/DELETE trigger on booking_item — we just DELETE old +
-- INSERT new under one advisory lock and the counters reconcile.
--
-- Caller (the create-booking EF in "edit mode") is responsible for:
--   - Re-running calculatePrice with excludeBookingId so unit_price_cents
--     and is_extra reflect post-refund FY usage
--   - Passing p_actor_id (the staff member's auth.uid) so the audit
--     trigger attributes the change to them, not "System"
--
-- For the resident "self-edit" path (future): same RPC, the resident's
-- own auth.uid flows through naturally.

CREATE OR REPLACE FUNCTION update_booking_items_in_place(
  p_booking_id        uuid,
  p_collection_date_id uuid,
  p_items             jsonb,
  p_actor_id          uuid DEFAULT NULL,
  p_location          text DEFAULT NULL,
  p_notes             text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking          booking%ROWTYPE;
  v_pool_id          uuid;
  v_date             date;
  v_pool_date_id     uuid;
  v_lock_key         bigint;
  v_item             jsonb;
  v_bulk_requested   integer := 0;
  v_anc_requested    integer := 0;
  v_id_requested     integer := 0;
  v_bulk_available   integer;
  v_anc_available    integer;
  v_id_available     integer;
BEGIN
  -- Audit-trigger actor context (PR #47 wiring).
  IF p_actor_id IS NOT NULL THEN
    PERFORM set_config('app.audit_actor', p_actor_id::text, true);
  END IF;

  -- Lock booking row for the duration of this transaction.
  SELECT * INTO v_booking FROM booking WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;

  -- Resolve advisory-lock key — pool-aware (same approach as
  -- create_booking_with_capacity_check so concurrent create + update on
  -- the same collection date can't race).
  SELECT capacity_pool_id INTO v_pool_id
  FROM collection_area WHERE id = v_booking.collection_area_id;

  IF v_pool_id IS NOT NULL THEN
    SELECT cd.date INTO v_date FROM collection_date cd WHERE cd.id = p_collection_date_id;
    SELECT id INTO v_pool_date_id FROM collection_date_pool
      WHERE capacity_pool_id = v_pool_id AND date = v_date;
    IF v_pool_date_id IS NULL THEN
      RAISE EXCEPTION 'No collection_date_pool row for pool % on date %', v_pool_id, v_date;
    END IF;
    v_lock_key := ('x' || substr(v_pool_date_id::text, 1, 8))::bit(32)::bigint;
  ELSE
    v_lock_key := ('x' || substr(p_collection_date_id::text, 1, 8))::bit(32)::bigint;
  END IF;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Sum capacity requested by new items.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    CASE v_item->>'category_code'
      WHEN 'bulk' THEN v_bulk_requested := v_bulk_requested + (v_item->>'no_services')::integer;
      WHEN 'anc'  THEN v_anc_requested  := v_anc_requested  + (v_item->>'no_services')::integer;
      WHEN 'id'   THEN v_id_requested   := v_id_requested   + (v_item->>'no_services')::integer;
    END CASE;
  END LOOP;

  -- DELETE old items. The recalculate_units AFTER trigger refunds the
  -- collection_date counters for each deleted row, freeing that capacity
  -- back into the pool before we check availability for the new items.
  DELETE FROM booking_item WHERE booking_id = p_booking_id;

  -- Capacity availability after refund.
  IF v_pool_id IS NOT NULL THEN
    SELECT bulk_capacity_limit - bulk_units_booked,
           anc_capacity_limit  - anc_units_booked,
           id_capacity_limit   - id_units_booked
    INTO v_bulk_available, v_anc_available, v_id_available
    FROM collection_date_pool WHERE id = v_pool_date_id;
  ELSE
    SELECT bulk_capacity_limit - bulk_units_booked,
           anc_capacity_limit  - anc_units_booked,
           id_capacity_limit   - id_units_booked
    INTO v_bulk_available, v_anc_available, v_id_available
    FROM collection_date WHERE id = p_collection_date_id;
  END IF;

  IF v_bulk_requested > 0 AND v_bulk_available < v_bulk_requested THEN
    RAISE EXCEPTION 'Insufficient bulk capacity on collection date';
  END IF;
  IF v_anc_requested > 0 AND v_anc_available < v_anc_requested THEN
    RAISE EXCEPTION 'Insufficient ancillary capacity on collection date';
  END IF;
  IF v_id_requested > 0 AND v_id_available < v_id_requested THEN
    RAISE EXCEPTION 'Insufficient illegal dumping capacity on collection date';
  END IF;

  -- INSERT new items. The recalculate_units trigger applies the new
  -- counters back to collection_date / collection_date_pool.
  INSERT INTO booking_item
    (booking_id, service_id, collection_date_id, no_services, unit_price_cents, is_extra)
  SELECT p_booking_id,
         (item->>'service_id')::uuid,
         p_collection_date_id,
         (item->>'no_services')::integer,
         (item->>'unit_price_cents')::integer,
         (item->>'is_extra')::boolean
  FROM jsonb_array_elements(p_items) AS item;

  -- Update booking-level fields only if the caller supplied them.
  -- Null params leave the existing column value untouched (COALESCE),
  -- so a caller editing only services can omit location/notes.
  IF p_location IS NOT NULL OR p_notes IS NOT NULL THEN
    UPDATE booking
       SET location = COALESCE(p_location, location),
           notes    = COALESCE(p_notes, notes)
     WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object('booking_id', p_booking_id, 'ref', v_booking.ref);
END;
$$;
