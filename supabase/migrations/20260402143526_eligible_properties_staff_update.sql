-- Recovered from live DB migration history on 2026-04-08.
-- This migration was applied directly via Supabase Studio and never committed
-- to git. Reconstructed verbatim from supabase_migrations.schema_migrations.

-- Allow admin roles to update eligible_properties (is_mud, is_eligible, geocode fields)
CREATE POLICY eligible_properties_staff_update ON eligible_properties FOR UPDATE
  TO authenticated
  USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids()))
  )
  WITH CHECK (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    AND collection_area_id IN (SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids()))
  );
