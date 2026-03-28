-- Add missing INSERT and UPDATE policies for service_ticket table.
-- The Edge Function uses service-role (bypasses RLS) for ticket creation,
-- but these policies are needed for defence-in-depth and for any future
-- direct client inserts.

-- Residents can insert tickets linked to their own contact
CREATE POLICY service_ticket_resident_insert ON service_ticket FOR INSERT
  WITH CHECK (
    contact_id = current_user_contact_id()
    AND current_user_role() = 'resident'
  );

-- Staff can insert tickets for any contact within their accessible clients
CREATE POLICY service_ticket_staff_insert ON service_ticket FOR INSERT
  WITH CHECK (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user())
  );

-- Staff can update tickets within their accessible clients
CREATE POLICY service_ticket_staff_update ON service_ticket FOR UPDATE
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user())
  )
  WITH CHECK (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user())
  );

-- Audit log INSERT policy — service-role bypasses RLS for Edge Function inserts,
-- but this allows staff-level audit entries if ever needed directly.
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (true);
