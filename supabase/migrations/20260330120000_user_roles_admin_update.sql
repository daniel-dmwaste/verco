-- Allow contractor-admin and client-admin to update user_roles within their scope.
CREATE POLICY user_roles_admin_update ON user_roles
  FOR UPDATE
  USING (
    (
      current_user_role() = 'contractor-admin'
      AND (
        contractor_id = current_user_contractor_id()
        OR client_id IN (SELECT accessible_client_ids())
      )
    )
    OR
    (
      current_user_role() = 'client-admin'
      AND client_id = current_user_client_id()
    )
  )
  WITH CHECK (
    (
      current_user_role() = 'contractor-admin'
      AND (
        contractor_id = current_user_contractor_id()
        OR client_id IN (SELECT accessible_client_ids())
      )
    )
    OR
    (
      current_user_role() = 'client-admin'
      AND client_id = current_user_client_id()
    )
  );
