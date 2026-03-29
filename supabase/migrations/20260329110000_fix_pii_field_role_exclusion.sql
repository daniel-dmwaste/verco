-- Fix PII suppression: field role must NOT access contacts or service tickets.
-- is_contractor_user() includes 'field', so these policies must use explicit
-- role checks excluding field/ranger.
--
-- Bug: contacts_contractor_select and service_ticket_staff_select/update
-- used is_contractor_user() which returns true for field role, leaking PII.

-- contacts: replace contractor select policy
DROP POLICY IF EXISTS contacts_contractor_select ON contacts;
CREATE POLICY contacts_contractor_select ON contacts FOR SELECT USING (
  current_user_role() IN ('contractor-admin', 'contractor-staff')
  AND EXISTS (
    SELECT 1 FROM booking b
    WHERE b.contact_id = contacts.id
      AND b.contractor_id = current_user_contractor_id()
  )
);

-- service_ticket: replace staff select policy
DROP POLICY IF EXISTS service_ticket_staff_select ON service_ticket;
CREATE POLICY service_ticket_staff_select ON service_ticket FOR SELECT USING (
  client_id IN (SELECT accessible_client_ids())
  AND (is_client_staff() OR current_user_role() IN ('contractor-admin', 'contractor-staff'))
);

-- service_ticket: replace staff update policy
DROP POLICY IF EXISTS service_ticket_staff_update ON service_ticket;
CREATE POLICY service_ticket_staff_update ON service_ticket FOR UPDATE USING (
  client_id IN (SELECT accessible_client_ids())
  AND (is_client_staff() OR current_user_role() IN ('contractor-admin', 'contractor-staff'))
);
