-- bulk_update_booking_item_actuals — set actual_services on multiple
-- booking_item rows in one round trip.
--
-- Previously `saveMudActualServices` looped TS-side and issued one UPDATE
-- per item. Typical MUD booking has 1-3 items so the wire cost is small,
-- but the loop was on a mobile field path (variable network) and Codex's
-- Phase 1 audit flagged it as low-effort/low-risk. This RPC consolidates
-- ownership verification + bulk UPDATE into one SQL call.
--
-- SECURITY INVOKER: the caller's role (field/contractor-admin etc.) gates
-- both the embedded SELECT (ownership check) and the UPDATE via existing
-- RLS policies on booking_item. Defense-in-depth ownership check is
-- expressed in SQL so a tampered jsonb payload can't cross-update items
-- from another booking.

CREATE OR REPLACE FUNCTION public.bulk_update_booking_item_actuals(
  p_booking_id uuid,
  p_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_supplied_count integer;
  v_matched_count integer;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  SELECT count(*) INTO v_supplied_count
  FROM jsonb_array_elements(p_updates);

  IF v_supplied_count = 0 THEN
    RAISE EXCEPTION 'No updates supplied';
  END IF;

  -- Ownership + existence check: every supplied id must resolve to a
  -- booking_item that belongs to p_booking_id AND that the caller's RLS
  -- allows them to read.
  SELECT count(*) INTO v_matched_count
  FROM jsonb_to_recordset(p_updates) AS u(id uuid, actual_count integer)
  JOIN booking_item bi ON bi.id = u.id
  WHERE bi.booking_id = p_booking_id;

  IF v_matched_count <> v_supplied_count THEN
    RAISE EXCEPTION
      'Ownership check failed: % of % booking_item ids matched booking %',
      v_matched_count, v_supplied_count, p_booking_id;
  END IF;

  -- Reject negative actual counts at the SQL boundary too.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_updates) AS u(id uuid, actual_count integer)
    WHERE u.actual_count IS NULL OR u.actual_count < 0
  ) THEN
    RAISE EXCEPTION 'Each actual_count must be a non-negative integer';
  END IF;

  -- Bulk UPDATE. RLS UPDATE policy on booking_item gates the write.
  UPDATE booking_item bi
  SET actual_services = u.actual_count
  FROM jsonb_to_recordset(p_updates) AS u(id uuid, actual_count integer)
  WHERE bi.id = u.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bulk_update_booking_item_actuals(uuid, jsonb) TO authenticated;
