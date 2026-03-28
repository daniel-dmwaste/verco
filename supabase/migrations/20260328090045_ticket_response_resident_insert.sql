-- Allow residents to insert responses on their own tickets.
-- The Edge Function uses service-role for writes, but this policy
-- provides defence-in-depth for any direct client inserts.

CREATE POLICY ticket_response_resident_insert ON ticket_response FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND author_type = 'resident'
    AND is_internal = false
    AND ticket_id IN (
      SELECT id FROM service_ticket WHERE contact_id = current_user_contact_id()
    )
  );

-- Staff can insert responses on tickets within their accessible clients
CREATE POLICY ticket_response_staff_insert ON ticket_response FOR INSERT
  WITH CHECK (
    (is_client_staff() OR is_contractor_user())
    AND ticket_id IN (
      SELECT id FROM service_ticket
      WHERE client_id IN (SELECT accessible_client_ids())
    )
  );
