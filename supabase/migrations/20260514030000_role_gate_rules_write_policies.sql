-- =============================================================================
-- Role-gate allocation_rules + service_rules write policies.
--
-- accessible_client_ids() routes through is_contractor_user(), which
-- includes the 'field' role. Without an explicit role gate, field users
-- could mutate pricing and free-allocation quotas across every client of
-- their contractor — contradicts CLAUDE.md §4 and §6.
--
-- Drops the original 6 policies (from 20260416092622) and recreates them
-- with role restricted to admin/staff tiers. collection_area_id scope
-- check is preserved on top — defence-in-depth.
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
