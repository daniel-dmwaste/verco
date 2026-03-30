-- Allow staff to read contacts linked to profiles they can see (for user management).
-- This supplements the existing booking-based policies.
CREATE POLICY contacts_staff_select_via_profiles ON contacts
  FOR SELECT
  USING (
    (
      current_user_role() IN ('contractor-admin', 'contractor-staff')
      AND id IN (
        SELECT p.contact_id FROM profiles p
        JOIN user_roles ur ON ur.user_id = p.id
        WHERE ur.is_active = true
          AND (
            ur.contractor_id = current_user_contractor_id()
            OR ur.client_id IN (SELECT accessible_client_ids())
          )
      )
    )
    OR
    (
      current_user_role() IN ('client-admin', 'client-staff')
      AND id IN (
        SELECT p.contact_id FROM profiles p
        JOIN user_roles ur ON ur.user_id = p.id
        WHERE ur.is_active = true
          AND ur.client_id = current_user_client_id()
      )
    )
  );
