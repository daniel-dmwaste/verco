-- Write policies for allocation_rules and service_rules
-- Scoped to collection areas under the user's accessible clients

-- allocation_rules: INSERT
CREATE POLICY allocation_rules_contractor_insert ON allocation_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- allocation_rules: UPDATE
CREATE POLICY allocation_rules_contractor_update ON allocation_rules
  FOR UPDATE TO authenticated
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- allocation_rules: DELETE
CREATE POLICY allocation_rules_contractor_delete ON allocation_rules
  FOR DELETE TO authenticated
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- service_rules: INSERT
CREATE POLICY service_rules_contractor_insert ON service_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- service_rules: UPDATE
CREATE POLICY service_rules_contractor_update ON service_rules
  FOR UPDATE TO authenticated
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- service_rules: DELETE
CREATE POLICY service_rules_contractor_delete ON service_rules
  FOR DELETE TO authenticated
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );
