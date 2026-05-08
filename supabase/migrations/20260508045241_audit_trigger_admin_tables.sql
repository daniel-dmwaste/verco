-- ============================================================
-- VER-183 — Audit triggers for admin-managed config tables
-- ============================================================
-- Extends the audit trail to cover six admin-managed tables that
-- previously had no change capture: client config, collection
-- areas, allocation/service rules, allocation overrides, and
-- refund requests. The audit_trigger_fn() function (defined in
-- 20260416100000_audit_trigger.sql) handles client_id derivation
-- via the table's own client_id column or, where absent, falls
-- back to the generic logic in the function. For tables without
-- a client_id column (allocation_rules, service_rules,
-- allocation_override) the audit_log entry will record a NULL
-- client_id — staff scoping for these admin-only tables is
-- enforced by RLS on the source table itself.
-- ============================================================

DROP TRIGGER IF EXISTS audit_trigger ON allocation_override;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON allocation_override
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON allocation_rules;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON allocation_rules
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON service_rules;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON service_rules
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON refund_request;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON refund_request
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON client;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON client
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON collection_area;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON collection_area
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
