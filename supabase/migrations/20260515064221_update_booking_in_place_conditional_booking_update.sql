-- Tighten update_booking_items_in_place's booking-row UPDATE so it only
-- fires when location or notes actually changed. Previously the EF always
-- passed p_location (current value if user didn't edit), so the RPC always
-- ran UPDATE booking, which the audit_trigger captures as a row touch →
-- appears in the timeline as "0 fields updated" (real columns unchanged,
-- only updated_at was touched).
--
-- This is the cosmetic fix Dan flagged after PR #50 landed in dev. The
-- harder fix (smart booking_item diff so unchanged items don't produce
-- "Service item created/deleted" pairs) is queued as a follow-up Linear
-- ticket — that's a bigger change because it interacts with the
-- recalculate_units trigger's net-balancing.

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
  IF p_actor_id IS NOT NULL THEN
    PERFORM set_config('app.audit_actor', p_actor_id::text, true);
  END IF;

  SELECT * INTO v_booking FROM booking WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;

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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    CASE v_item->>'category_code'
      WHEN 'bulk' THEN v_bulk_requested := v_bulk_requested + (v_item->>'no_services')::integer;
      WHEN 'anc'  THEN v_anc_requested  := v_anc_requested  + (v_item->>'no_services')::integer;
      WHEN 'id'   THEN v_id_requested   := v_id_requested   + (v_item->>'no_services')::integer;
    END CASE;
  END LOOP;

  DELETE FROM booking_item WHERE booking_id = p_booking_id;

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

  INSERT INTO booking_item
    (booking_id, service_id, collection_date_id, no_services, unit_price_cents, is_extra)
  SELECT p_booking_id,
         (item->>'service_id')::uuid,
         p_collection_date_id,
         (item->>'no_services')::integer,
         (item->>'unit_price_cents')::integer,
         (item->>'is_extra')::boolean
  FROM jsonb_array_elements(p_items) AS item;

  -- Only touch the booking row if location or notes ACTUALLY differ.
  -- This is the cosmetic fix that eliminates the "0 fields updated" audit
  -- entry residents/staff were seeing on every edit save (the audit trigger
  -- fires for any UPDATE, even a no-op set-to-current-value).
  --
  -- IS DISTINCT FROM treats NULL correctly (NULL IS DISTINCT FROM NULL = false),
  -- so passing the existing value as p_location or p_notes is a clean no-op.
  IF (p_location IS NOT NULL AND p_location IS DISTINCT FROM v_booking.location)
     OR (p_notes IS NOT NULL AND p_notes IS DISTINCT FROM v_booking.notes) THEN
    UPDATE booking
       SET location = COALESCE(p_location, location),
           notes    = COALESCE(p_notes, notes)
     WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object('booking_id', p_booking_id, 'ref', v_booking.ref);
END;
$$;
