-- ============================================================
-- Audit trigger: automatic change capture for admin audit trail
-- ============================================================

-- 1. Create the audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_old jsonb := NULL;
  v_new jsonb := NULL;
  v_record_id uuid;
  v_client_id uuid := NULL;
  v_contractor_id uuid := NULL;
BEGIN
  -- Capture old/new as JSONB
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW);
  END IF;

  -- Derive record ID
  v_record_id := COALESCE(
    CASE WHEN v_new IS NOT NULL THEN (v_new->>'id')::uuid END,
    CASE WHEN v_old IS NOT NULL THEN (v_old->>'id')::uuid END
  );

  -- Strip known large fields to avoid audit_log bloat
  IF v_old IS NOT NULL THEN
    v_old := v_old - 'photos' - 'geom';
  END IF;
  IF v_new IS NOT NULL THEN
    v_new := v_new - 'photos' - 'geom';
  END IF;

  -- ── Derive client_id ──────────────────────────────────────
  -- Tables with direct client_id column
  IF v_new IS NOT NULL AND v_new ? 'client_id' AND v_new->>'client_id' IS NOT NULL THEN
    v_client_id := (v_new->>'client_id')::uuid;
  ELSIF v_old IS NOT NULL AND v_old ? 'client_id' AND v_old->>'client_id' IS NOT NULL THEN
    v_client_id := (v_old->>'client_id')::uuid;

  -- booking_item → booking.client_id
  ELSIF TG_TABLE_NAME = 'booking_item' THEN
    SELECT client_id INTO v_client_id
    FROM booking
    WHERE id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'booking_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'booking_id')::uuid END
    );

  -- ticket_response → service_ticket.client_id
  ELSIF TG_TABLE_NAME = 'ticket_response' THEN
    SELECT client_id INTO v_client_id
    FROM service_ticket
    WHERE id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'ticket_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'ticket_id')::uuid END
    );

  -- collection_date, eligible_properties → collection_area.client_id
  ELSIF TG_TABLE_NAME IN ('collection_date', 'eligible_properties') THEN
    SELECT client_id INTO v_client_id
    FROM collection_area
    WHERE id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'collection_area_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'collection_area_id')::uuid END
    );

  -- strata_user_properties → eligible_properties → collection_area.client_id
  ELSIF TG_TABLE_NAME = 'strata_user_properties' THEN
    SELECT ca.client_id INTO v_client_id
    FROM eligible_properties ep
    JOIN collection_area ca ON ca.id = ep.collection_area_id
    WHERE ep.id = COALESCE(
      CASE WHEN v_new IS NOT NULL THEN (v_new->>'property_id')::uuid END,
      CASE WHEN v_old IS NOT NULL THEN (v_old->>'property_id')::uuid END
    );

  -- contacts → booking.client_id (most recent booking referencing this contact)
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    SELECT b.client_id INTO v_client_id
    FROM booking b
    WHERE b.contact_id = v_record_id
    ORDER BY b.created_at DESC
    LIMIT 1;
  END IF;

  -- ── Derive contractor_id ──────────────────────────────────
  IF v_new IS NOT NULL AND v_new ? 'contractor_id' AND v_new->>'contractor_id' IS NOT NULL THEN
    v_contractor_id := (v_new->>'contractor_id')::uuid;
  ELSIF v_old IS NOT NULL AND v_old ? 'contractor_id' AND v_old->>'contractor_id' IS NOT NULL THEN
    v_contractor_id := (v_old->>'contractor_id')::uuid;
  END IF;

  -- ── Insert audit entry ────────────────────────────────────
  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, client_id, contractor_id)
  VALUES (TG_TABLE_NAME, v_record_id, TG_OP, v_old, v_new, auth.uid(), v_client_id, v_contractor_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Attach triggers to target tables (idempotent — safe to re-apply)
DROP TRIGGER IF EXISTS audit_trigger ON booking;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON booking
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON booking_item;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON booking_item
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON non_conformance_notice;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON non_conformance_notice
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON nothing_presented;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON nothing_presented
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON service_ticket;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON service_ticket
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON ticket_response;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON ticket_response
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON collection_date;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON collection_date
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON strata_user_properties;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON strata_user_properties
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON contacts;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON eligible_properties;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON eligible_properties
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();


-- 3. Update RLS policy to include staff roles (not just admins)
DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND current_user_role() IN ('client-admin', 'client-staff', 'contractor-admin', 'contractor-staff')
  );


-- 4. Optimised index for detail page queries
CREATE INDEX IF NOT EXISTS idx_audit_log_record_created
  ON audit_log (table_name, record_id, created_at DESC);
