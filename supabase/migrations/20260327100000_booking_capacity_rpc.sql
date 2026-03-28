-- =============================================================================
-- Booking Capacity RPC + Recalculation Trigger
-- =============================================================================
-- Provides:
--   1. generate_booking_ref(area_code) — {area_code}-{6 random alphanum}
--   2. recalculate_collection_date_units() — trigger on booking_item changes
--   3. create_booking_with_capacity_check() — atomic capacity check + insert
-- =============================================================================

-- ── 1. Booking ref generator ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_booking_ref(p_area_code text)
RETURNS text AS $$
DECLARE
  v_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_ref text;
  v_suffix text;
  v_exists boolean;
BEGIN
  LOOP
    v_suffix := '';
    FOR i IN 1..6 LOOP
      v_suffix := v_suffix || substr(v_chars, floor(random() * 36 + 1)::int, 1);
    END LOOP;
    v_ref := p_area_code || '-' || v_suffix;

    SELECT EXISTS(SELECT 1 FROM booking WHERE ref = v_ref) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  RETURN v_ref;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Capacity recalculation trigger ────────────────────────────────────────

CREATE OR REPLACE FUNCTION recalculate_collection_date_units()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE collection_date cd
  SET
    bulk_units_booked = (
      SELECT COALESCE(SUM(bi.no_services), 0)
      FROM booking_item bi
      JOIN booking b ON b.id = bi.booking_id
      JOIN service s ON s.id = bi.service_id
      JOIN category c ON c.id = s.category_id
      WHERE bi.collection_date_id = cd.id
      AND c.code = 'bulk'
      AND b.status NOT IN ('Cancelled', 'Pending Payment')
    ),
    anc_units_booked = (
      SELECT COALESCE(SUM(bi.no_services), 0)
      FROM booking_item bi
      JOIN booking b ON b.id = bi.booking_id
      JOIN service s ON s.id = bi.service_id
      JOIN category c ON c.id = s.category_id
      WHERE bi.collection_date_id = cd.id
      AND c.code = 'anc'
      AND b.status NOT IN ('Cancelled', 'Pending Payment')
    ),
    id_units_booked = (
      SELECT COALESCE(SUM(bi.no_services), 0)
      FROM booking_item bi
      JOIN booking b ON b.id = bi.booking_id
      JOIN service s ON s.id = bi.service_id
      JOIN category c ON c.id = s.category_id
      WHERE bi.collection_date_id = cd.id
      AND c.code = 'id'
      AND b.status NOT IN ('Cancelled', 'Pending Payment')
    )
  WHERE cd.id = COALESCE(NEW.collection_date_id, OLD.collection_date_id);

  -- Recalculate is_closed flags
  UPDATE collection_date
  SET
    bulk_is_closed = (bulk_units_booked >= bulk_capacity_limit),
    anc_is_closed  = (anc_units_booked >= anc_capacity_limit),
    id_is_closed   = (id_units_booked >= id_capacity_limit)
  WHERE id = COALESCE(NEW.collection_date_id, OLD.collection_date_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recalculate_units
  AFTER INSERT OR UPDATE OR DELETE ON booking_item
  FOR EACH ROW EXECUTE FUNCTION recalculate_collection_date_units();

-- ── 3. Atomic capacity check + booking insert ────────────────────────────────
-- Uses advisory lock keyed on collection_date_id to prevent race conditions.
-- Accepts full booking payload and inserts booking + all items in one transaction.

CREATE OR REPLACE FUNCTION create_booking_with_capacity_check(
  p_collection_date_id uuid,
  p_property_id uuid,
  p_contact_id uuid,
  p_collection_area_id uuid,
  p_client_id uuid,
  p_contractor_id uuid,
  p_fy_id uuid,
  p_area_code text,
  p_location text,
  p_notes text,
  p_status text,
  p_items jsonb  -- array of { service_id, no_services, unit_price_cents, is_extra, category_code }
)
RETURNS jsonb AS $$
DECLARE
  v_lock_key bigint;
  v_booking_id uuid;
  v_ref text;
  v_item jsonb;
  v_cat_code text;
  v_units_requested integer;
  v_bulk_requested integer := 0;
  v_anc_requested integer := 0;
  v_id_requested integer := 0;
  v_bulk_available integer;
  v_anc_available integer;
  v_id_available integer;
BEGIN
  -- Advisory lock keyed on collection_date_id to serialise concurrent bookings
  v_lock_key := ('x' || substr(p_collection_date_id::text, 1, 8))::bit(32)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Aggregate requested units per category bucket
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cat_code := v_item->>'category_code';
    v_units_requested := (v_item->>'no_services')::integer;

    CASE v_cat_code
      WHEN 'bulk' THEN v_bulk_requested := v_bulk_requested + v_units_requested;
      WHEN 'anc'  THEN v_anc_requested := v_anc_requested + v_units_requested;
      WHEN 'id'   THEN v_id_requested := v_id_requested + v_units_requested;
    END CASE;
  END LOOP;

  -- Check capacity for each bucket that has requested units
  SELECT
    bulk_capacity_limit - bulk_units_booked,
    anc_capacity_limit - anc_units_booked,
    id_capacity_limit - id_units_booked
  INTO v_bulk_available, v_anc_available, v_id_available
  FROM collection_date
  WHERE id = p_collection_date_id;

  IF v_bulk_requested > 0 AND v_bulk_available < v_bulk_requested THEN
    RAISE EXCEPTION 'Insufficient bulk capacity on collection date';
  END IF;

  IF v_anc_requested > 0 AND v_anc_available < v_anc_requested THEN
    RAISE EXCEPTION 'Insufficient ancillary capacity on collection date';
  END IF;

  IF v_id_requested > 0 AND v_id_available < v_id_requested THEN
    RAISE EXCEPTION 'Insufficient illegal dumping capacity on collection date';
  END IF;

  -- Generate booking ref
  v_ref := generate_booking_ref(p_area_code);

  -- Insert booking
  INSERT INTO booking (
    ref, status, property_id, contact_id, collection_area_id,
    client_id, contractor_id, fy_id, location, notes
  ) VALUES (
    v_ref, p_status::booking_status, p_property_id, p_contact_id, p_collection_area_id,
    p_client_id, p_contractor_id, p_fy_id, p_location, p_notes
  )
  RETURNING id INTO v_booking_id;

  -- Insert booking items (unit_price_cents set by server, never from client)
  INSERT INTO booking_item (
    booking_id, service_id, collection_date_id, no_services, unit_price_cents, is_extra
  )
  SELECT
    v_booking_id,
    (item->>'service_id')::uuid,
    p_collection_date_id,
    (item->>'no_services')::integer,
    (item->>'unit_price_cents')::integer,
    (item->>'is_extra')::boolean
  FROM jsonb_array_elements(p_items) AS item;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'ref', v_ref
  );
END;
$$ LANGUAGE plpgsql;
