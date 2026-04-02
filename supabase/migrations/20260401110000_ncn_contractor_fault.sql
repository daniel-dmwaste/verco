-- Add contractor_fault flag to non_conformance_notice
-- When true, original booking items are excluded from allocation counting
ALTER TABLE non_conformance_notice ADD COLUMN contractor_fault boolean NOT NULL DEFAULT false;

-- Staff UPDATE policy for NCN (resolve, investigate, rebook actions)
-- Excludes field and ranger roles — they record NCNs but don't resolve them
CREATE POLICY ncn_staff_update ON non_conformance_notice FOR UPDATE
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
  )
  WITH CHECK (
    client_id IN (SELECT accessible_client_ids())
    AND current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
  );
