-- Audit log: capture actor for writes that pass through service role / RPCs.
--
-- Problem: 99.996% of audit_log entries (178,413 of 178,421 in the last 7
-- days) have changed_by = NULL. The trigger uses auth.uid(), which returns
-- null for any write done via service-role (Edge Functions bypassing RLS),
-- cron, or direct admin SQL. Only direct authenticated writes (e.g. server
-- actions doing supabase.from().insert() with the cookie-session client)
-- preserve auth.uid().
--
-- Most visible symptom: every booking shows "System" in the activity log
-- because /book/confirm goes through the create-booking Edge Function which
-- uses service role to bypass RLS on the capacity-check RPC. The booking
-- correctly attributes the *resident* via contact_id, but loses the *actor*
-- (whoever clicked submit — a staff member doing "book on behalf", or
-- nobody if a real resident).
--
-- Fix: add an explicit-actor passthrough channel.
--   1. The audit trigger falls back to a transaction-local session var
--      `app.audit_actor` when auth.uid() is null.
--   2. The booking-creation RPC accepts a new p_actor_id parameter and
--      sets that session var at its top — so all inserts done by the RPC
--      see the actor in the same transaction.
--   3. Callers (EFs, server actions) decode the calling user's JWT and
--      pass user.id as p_actor_id. Anonymous bookings pass NULL → still
--      "System", which is correct.
--
-- Backward compatible: p_actor_id defaults to NULL. Existing callers
-- without the new param work unchanged (still log as System).

-- ── 1. Trigger: COALESCE actor sources ────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_old jsonb := NULL;
  v_new jsonb := NULL;
  v_record_id uuid;
  v_client_id uuid := NULL;
  v_contractor_id uuid := NULL;
  v_actor uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW);
  END IF;

  v_record_id := COALESCE(
    CASE WHEN v_new IS NOT NULL THEN (v_new->>'id')::uuid END,
    CASE WHEN v_old IS NOT NULL THEN (v_old->>'id')::uuid END
  );

  IF v_old IS NOT NULL THEN
    v_old := v_old - 'photos' - 'geom';
  END IF;
  IF v_new IS NOT NULL THEN
    v_new := v_new - 'photos' - 'geom';
  END IF;

  -- Client/contractor resolution (unchanged from prior version)
  IF v_new IS NOT NULL AND v_new ? 'client_id' AND v_new->>'client_id' IS NOT NULL THEN
    v_client_id := (v_new->>'client_id')::uuid;
  ELSIF v_old IS NOT NULL AND v_old ? 'client_id' AND v_old->>'client_id' IS NOT NULL THEN
    v_client_id := (v_old->>'client_id')::uuid;

  ELSIF TG_TABLE_NAME = 'booking_item' THEN
    SELECT client_id INTO v_client_id
    FROM booking
    WHERE id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'booking_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'booking_id')::uuid END
    );

  ELSIF TG_TABLE_NAME = 'ticket_response' THEN
    SELECT client_id INTO v_client_id
    FROM service_ticket
    WHERE id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'ticket_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'ticket_id')::uuid END
    );

  ELSIF TG_TABLE_NAME IN ('collection_date', 'eligible_properties') THEN
    SELECT client_id INTO v_client_id
    FROM collection_area
    WHERE id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'collection_area_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'collection_area_id')::uuid END
    );

  ELSIF TG_TABLE_NAME IN ('allocation_rules', 'service_rules') THEN
    SELECT client_id INTO v_client_id
    FROM collection_area
    WHERE id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'collection_area_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'collection_area_id')::uuid END
    );

  ELSIF TG_TABLE_NAME = 'strata_user_properties' THEN
    SELECT ca.client_id INTO v_client_id
    FROM eligible_properties ep
    JOIN collection_area ca ON ca.id = ep.collection_area_id
    WHERE ep.id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'property_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'property_id')::uuid END
    );

  ELSIF TG_TABLE_NAME = 'allocation_override' THEN
    SELECT ca.client_id INTO v_client_id
    FROM eligible_properties ep
    JOIN collection_area ca ON ca.id = ep.collection_area_id
    WHERE ep.id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'property_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'property_id')::uuid END
    );

  ELSIF TG_TABLE_NAME = 'contacts' THEN
    SELECT b.client_id INTO v_client_id
    FROM booking b
    WHERE b.contact_id = v_record_id
    ORDER BY b.created_at DESC
    LIMIT 1;
  END IF;

  IF v_new IS NOT NULL AND v_new ? 'contractor_id' AND v_new->>'contractor_id' IS NOT NULL THEN
    v_contractor_id := (v_new->>'contractor_id')::uuid;
  ELSIF v_old IS NOT NULL AND v_old ? 'contractor_id' AND v_old->>'contractor_id' IS NOT NULL THEN
    v_contractor_id := (v_old->>'contractor_id')::uuid;
  END IF;

  -- ── NEW: capture actor with fallback ────────────────────────────────
  -- 1. auth.uid() — set by PostgREST from JWT for direct authenticated writes
  -- 2. app.audit_actor — transaction-local session var, set by RPCs / wrappers
  --    that need to attribute writes done via service role
  -- 3. NULL — genuine system actions (cron, anonymous flows)
  v_actor := COALESCE(
    auth.uid(),
    NULLIF(current_setting('app.audit_actor', true), '')::uuid
  );

  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, client_id, contractor_id)
  VALUES (TG_TABLE_NAME, v_record_id, TG_OP, v_old, v_new, v_actor, v_client_id, v_contractor_id);

  RETURN COALESCE(NEW, OLD);
END;
$function$;


-- ── 2. RPC: accept p_actor_id and set session var ────────────────────
--
-- Adding a parameter changes the function identifier — Postgres treats the
-- new signature as a separate overload. Drop the old signature first so
-- there's only one. PostgREST resolves the new one by parameter set.

DROP FUNCTION IF EXISTS public.create_booking_with_capacity_check(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb
);

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
  p_items jsonb,
  p_actor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_pool_id         uuid;
  v_date            date;
  v_pool_date_id    uuid;
  v_lock_key        bigint;
  v_booking_id      uuid;
  v_ref             text;
  v_item            jsonb;
  v_cat_code        text;
  v_units_requested integer;
  v_bulk_requested  integer := 0;
  v_anc_requested   integer := 0;
  v_id_requested    integer := 0;
  v_bulk_available  integer;
  v_anc_available   integer;
  v_id_available    integer;
BEGIN
  -- Set audit actor as the FIRST action so every subsequent INSERT trigger
  -- sees it. Transaction-local (third arg = true) so the var doesn't leak
  -- to other transactions in the pool.
  IF p_actor_id IS NOT NULL THEN
    PERFORM set_config('app.audit_actor', p_actor_id::text, true);
  END IF;

  SELECT capacity_pool_id INTO v_pool_id
  FROM collection_area
  WHERE id = p_collection_area_id;

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

  PERFORM pg_advisory_xact_lock(v_lock_key);

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

  v_ref := generate_booking_ref(p_area_code);

  INSERT INTO booking (
    ref, status, property_id, contact_id, collection_area_id,
    client_id, contractor_id, fy_id, location, notes
  ) VALUES (
    v_ref, p_status::booking_status, p_property_id, p_contact_id, p_collection_area_id,
    p_client_id, p_contractor_id, p_fy_id, p_location, p_notes
  )
  RETURNING id INTO v_booking_id;

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
