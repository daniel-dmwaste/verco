-- =============================================================================
-- Role-gate allocation_rules + service_rules write policies
--
-- The original write policies (20260416092622_allocation_service_rules_write_policies.sql)
-- gated on accessible_client_ids() only — which routes through
-- is_contractor_user() and INCLUDES the 'field' role (CLAUDE.md §4 + the
-- 2026-04-08 rls-security-patterns memory). Effect: field users could
-- mutate pricing and free-allocation quotas across every client of
-- their contractor. P0-6 in UAT_READINESS_REVIEW.md.
--
-- This migration drops the original 6 policies and recreates them
-- with an explicit role gate restricting writes to admin/staff tiers:
-- contractor-admin, contractor-staff, client-admin, client-staff.
-- field, ranger, resident, strata are now denied.
--
-- The collection_area_id scope check (existing) is preserved on top
-- of the role gate — defence-in-depth.
-- =============================================================================

-- ─── allocation_rules ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS allocation_rules_contractor_insert ON allocation_rules;
DROP POLICY IF EXISTS allocation_rules_contractor_update ON allocation_rules;
DROP POLICY IF EXISTS allocation_rules_contractor_delete ON allocation_rules;

CREATE POLICY allocation_rules_admin_insert ON allocation_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

CREATE POLICY allocation_rules_admin_update ON allocation_rules
  FOR UPDATE TO authenticated
  USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  )
  WITH CHECK (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

CREATE POLICY allocation_rules_admin_delete ON allocation_rules
  FOR DELETE TO authenticated
  USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- ─── service_rules ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS service_rules_contractor_insert ON service_rules;
DROP POLICY IF EXISTS service_rules_contractor_update ON service_rules;
DROP POLICY IF EXISTS service_rules_contractor_delete ON service_rules;

CREATE POLICY service_rules_admin_insert ON service_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

CREATE POLICY service_rules_admin_update ON service_rules
  FOR UPDATE TO authenticated
  USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  )
  WITH CHECK (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

CREATE POLICY service_rules_admin_delete ON service_rules
  FOR DELETE TO authenticated
  USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );
