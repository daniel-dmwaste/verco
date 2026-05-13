-- Capacity Pool — first-class abstraction for shared-crew capacity across
-- multiple collection areas. Currently used only for MCP (Mosman + Cottesloe
-- + Peppermint Grove + Fremantle North) which share one truck/crew at
-- 60 stops/day.
--
-- Design spec: docs/superpowers/specs/2026-05-13-capacity-pool-design.md
--
-- Behaviour invariant: for any collection_area
--   capacity_pool_id IS NULL     → use collection_date counters (existing)
--   capacity_pool_id IS NOT NULL → use collection_date_pool counters;
--                                  collection_date counters stay at 0
--
-- This migration:
--   1. Creates capacity_pool + collection_date_pool tables with RLS.
--   2. Adds collection_area.capacity_pool_id (nullable FK).
--   3. Replaces create_booking_with_capacity_check with pool-aware version.
--   4. Replaces recalculate_collection_date_units with pool-aware version.
--   5. Seeds the MCP pool and links MOS/COT/PEP/FRE-N to it.
--
-- Per-area path (used by 9 of 11 VV areas + KWN) is unchanged — pool
-- branches only activate when collection_area.capacity_pool_id IS NOT NULL.

-- 1. capacity_pool table
CREATE TABLE capacity_pool (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES contractor(id) ON DELETE RESTRICT,
  code            text NOT NULL,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, code)
);

CREATE TRIGGER capacity_pool_updated_at
  BEFORE UPDATE ON capacity_pool
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE capacity_pool ENABLE ROW LEVEL SECURITY;

-- Public SELECT (mirrors collection_area / collection_date pattern — booking
-- flow is unauthenticated and needs to read pool metadata).
CREATE POLICY capacity_pool_public_select ON capacity_pool
  FOR SELECT USING (true);

-- Mutations restricted to contractor admins/staff for own contractor.
CREATE POLICY capacity_pool_contractor_admin_all ON capacity_pool
  FOR ALL USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff')
    AND contractor_id = current_user_contractor_id()
  );

-- 2. collection_area pool membership FK
ALTER TABLE collection_area
  ADD COLUMN capacity_pool_id uuid REFERENCES capacity_pool(id) ON DELETE SET NULL;

CREATE INDEX collection_area_capacity_pool_id_idx
  ON collection_area(capacity_pool_id)
  WHERE capacity_pool_id IS NOT NULL;

-- 3. collection_date_pool table (per-date capacity counters keyed on pool)
CREATE TABLE collection_date_pool (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_pool_id      uuid NOT NULL REFERENCES capacity_pool(id) ON DELETE CASCADE,
  date                  date NOT NULL,
  bulk_capacity_limit   integer NOT NULL DEFAULT 0,
  bulk_units_booked     integer NOT NULL DEFAULT 0,
  bulk_is_closed        boolean NOT NULL DEFAULT false,
  anc_capacity_limit    integer NOT NULL DEFAULT 0,
  anc_units_booked      integer NOT NULL DEFAULT 0,
  anc_is_closed         boolean NOT NULL DEFAULT false,
  id_capacity_limit     integer NOT NULL DEFAULT 0,
  id_units_booked       integer NOT NULL DEFAULT 0,
  id_is_closed          boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capacity_pool_id, date)
);

CREATE INDEX collection_date_pool_pool_date_idx
  ON collection_date_pool(capacity_pool_id, date);

CREATE TRIGGER collection_date_pool_updated_at
  BEFORE UPDATE ON collection_date_pool
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE collection_date_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_date_pool_public_select ON collection_date_pool
  FOR SELECT USING (true);

-- Counter updates happen via SECURITY DEFINER functions (RPC + trigger) so we
-- restrict direct writes to contractor admins.
CREATE POLICY collection_date_pool_contractor_admin_all ON collection_date_pool
  FOR ALL USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff')
    AND capacity_pool_id IN (
      SELECT id FROM capacity_pool WHERE contractor_id = current_user_contractor_id()
    )
  );

-- 4. create_booking_with_capacity_check — pool-aware version
CREATE OR REPLACE FUNCTION public.create_booking_with_capacity_check(
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
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_pool_id        uuid;
  v_date           date;
  v_pool_date_id   uuid;
  v_lock_key       bigint;
  v_booking_id     uuid;
  v_ref            text;
  v_item           jsonb;
  v_cat_code       text;
  v_units_requested integer;
  v_bulk_requested integer := 0;
  v_anc_requested  integer := 0;
  v_id_requested   integer := 0;
  v_bulk_available integer;
  v_anc_available  integer;
  v_id_available   integer;
BEGIN
  -- Determine pool membership for this area (NULL for unpooled areas).
  SELECT capacity_pool_id INTO v_pool_id
  FROM collection_area
  WHERE id = p_collection_area_id;

  -- For pooled areas, resolve the pool's per-date row up front so we know
  -- which lock key to acquire. We RAISE early if the pool row is missing —
  -- bookings against unscheduled pool dates must not silently succeed.
  IF v_pool_id IS NOT NULL THEN
    SELECT cd.date INTO v_date
    FROM collection_date cd
    WHERE cd.id = p_collection_date_id;

    SELECT id INTO v_pool_date_id
    FROM collection_date_pool
    WHERE capacity_pool_id = v_pool_id AND date = v_date;

    IF v_pool_date_id IS NULL THEN
      RAISE EXCEPTION 'No collection_date_pool row for pool % on date %', v_pool_id, v_date;
    END IF;

    v_lock_key := ('x' || substr(v_pool_date_id::text, 1, 8))::bit(32)::bigint;
  ELSE
    v_lock_key := ('x' || substr(p_collection_date_id::text, 1, 8))::bit(32)::bigint;
  END IF;

  -- Acquire advisory lock — concurrent bookings on the same pool date (or
  -- same per-area date for unpooled) serialise here.
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Aggregate requested units per category bucket
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cat_code := v_item->>'category_code';
    v_units_requested := (v_item->>'no_services')::integer;

    CASE v_cat_code
      WHEN 'bulk' THEN v_bulk_requested := v_bulk_requested + v_units_requested;
      WHEN 'anc'  THEN v_anc_requested  := v_anc_requested  + v_units_requested;
      WHEN 'id'   THEN v_id_requested   := v_id_requested   + v_units_requested;
    END CASE;
  END LOOP;

  -- Read capacity AFTER lock (consistent values).
  IF v_pool_id IS NOT NULL THEN
    SELECT bulk_capacity_limit - bulk_units_booked,
           anc_capacity_limit  - anc_units_booked,
           id_capacity_limit   - id_units_booked
    INTO v_bulk_available, v_anc_available, v_id_available
    FROM collection_date_pool
    WHERE id = v_pool_date_id;
  ELSE
    SELECT bulk_capacity_limit - bulk_units_booked,
           anc_capacity_limit  - anc_units_booked,
           id_capacity_limit   - id_units_booked
    INTO v_bulk_available, v_anc_available, v_id_available
    FROM collection_date
    WHERE id = p_collection_date_id;
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

  -- Insert booking items. collection_date_id remains the per-area row even
  -- for pooled bookings — preserves per-LGA reporting and the existing FK.
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
$function$;

-- 5. recalculate_collection_date_units — pool-aware version
-- For unpooled areas: recompute per-area collection_date counters (existing).
-- For pooled areas: recompute collection_date_pool counters by aggregating
-- bookings across ALL pool-member collection_date rows for that date.
CREATE OR REPLACE FUNCTION public.recalculate_collection_date_units()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_date_id uuid := COALESCE(NEW.collection_date_id, OLD.collection_date_id);
  v_pool_id uuid;
  v_date    date;
BEGIN
  -- Resolve pool membership + date for this booking_item's collection_date.
  SELECT ca.capacity_pool_id, cd.date
  INTO v_pool_id, v_date
  FROM collection_date cd
  JOIN collection_area ca ON ca.id = cd.collection_area_id
  WHERE cd.id = v_date_id;

  IF v_pool_id IS NULL THEN
    -- Per-area path (existing behaviour)
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
    WHERE cd.id = v_date_id;

    UPDATE collection_date
    SET
      bulk_is_closed = (bulk_units_booked >= bulk_capacity_limit),
      anc_is_closed  = (anc_units_booked  >= anc_capacity_limit),
      id_is_closed   = (id_units_booked   >= id_capacity_limit)
    WHERE id = v_date_id;
  ELSE
    -- Pooled path: aggregate booking_items across ALL pool-member
    -- collection_date rows for this date.
    UPDATE collection_date_pool cdp
    SET
      bulk_units_booked = (
        SELECT COALESCE(SUM(bi.no_services), 0)
        FROM booking_item bi
        JOIN booking b ON b.id = bi.booking_id
        JOIN service s ON s.id = bi.service_id
        JOIN category c ON c.id = s.category_id
        JOIN collection_date cd2 ON cd2.id = bi.collection_date_id
        JOIN collection_area ca2 ON ca2.id = cd2.collection_area_id
        WHERE ca2.capacity_pool_id = v_pool_id
        AND cd2.date = v_date
        AND c.code = 'bulk'
        AND b.status NOT IN ('Cancelled', 'Pending Payment')
      ),
      anc_units_booked = (
        SELECT COALESCE(SUM(bi.no_services), 0)
        FROM booking_item bi
        JOIN booking b ON b.id = bi.booking_id
        JOIN service s ON s.id = bi.service_id
        JOIN category c ON c.id = s.category_id
        JOIN collection_date cd2 ON cd2.id = bi.collection_date_id
        JOIN collection_area ca2 ON ca2.id = cd2.collection_area_id
        WHERE ca2.capacity_pool_id = v_pool_id
        AND cd2.date = v_date
        AND c.code = 'anc'
        AND b.status NOT IN ('Cancelled', 'Pending Payment')
      ),
      id_units_booked = (
        SELECT COALESCE(SUM(bi.no_services), 0)
        FROM booking_item bi
        JOIN booking b ON b.id = bi.booking_id
        JOIN service s ON s.id = bi.service_id
        JOIN category c ON c.id = s.category_id
        JOIN collection_date cd2 ON cd2.id = bi.collection_date_id
        JOIN collection_area ca2 ON ca2.id = cd2.collection_area_id
        WHERE ca2.capacity_pool_id = v_pool_id
        AND cd2.date = v_date
        AND c.code = 'id'
        AND b.status NOT IN ('Cancelled', 'Pending Payment')
      )
    WHERE cdp.capacity_pool_id = v_pool_id AND cdp.date = v_date;

    UPDATE collection_date_pool
    SET
      bulk_is_closed = (bulk_units_booked >= bulk_capacity_limit),
      anc_is_closed  = (anc_units_booked  >= anc_capacity_limit),
      id_is_closed   = (id_units_booked   >= id_capacity_limit)
    WHERE capacity_pool_id = v_pool_id AND date = v_date;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 6. Seed the MCP pool and link the four member areas.
INSERT INTO capacity_pool (contractor_id, code, name)
SELECT id, 'MCP', 'Mosman + Cottesloe + Peppermint Grove + Fremantle North'
FROM contractor WHERE slug = 'dmwm'
ON CONFLICT (contractor_id, code) DO NOTHING;

UPDATE collection_area
SET capacity_pool_id = (
  SELECT cp.id FROM capacity_pool cp
  JOIN contractor c ON c.id = cp.contractor_id
  WHERE cp.code = 'MCP' AND c.slug = 'dmwm'
)
WHERE code IN ('MOS', 'COT', 'PEP', 'FRE-N');

-- 7. Sanity check — exactly 4 areas should now be linked to the MCP pool.
DO $$
DECLARE
  v_member_count integer;
BEGIN
  SELECT COUNT(*) INTO v_member_count
  FROM collection_area ca
  JOIN capacity_pool cp ON cp.id = ca.capacity_pool_id
  WHERE cp.code = 'MCP';

  IF v_member_count <> 4 THEN
    RAISE EXCEPTION 'Expected 4 MCP pool members (MOS, COT, PEP, FRE-N), got %', v_member_count;
  END IF;
END $$;
