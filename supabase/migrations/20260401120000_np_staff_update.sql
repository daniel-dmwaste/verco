-- Rename dm_fault to contractor_fault for consistency with NCN
ALTER TABLE nothing_presented RENAME COLUMN dm_fault TO contractor_fault;

-- Staff UPDATE policy for nothing_presented (resolve, investigate, rebook actions)
-- Excludes field and ranger roles — they record NPs but don't resolve them
CREATE POLICY np_staff_update ON nothing_presented FOR UPDATE
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
  )
  WITH CHECK (
    client_id IN (SELECT accessible_client_ids())
    AND current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
  );
