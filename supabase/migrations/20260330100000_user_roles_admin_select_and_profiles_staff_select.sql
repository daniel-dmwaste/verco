-- Allow contractor-admin and contractor-staff to see all user_roles
-- scoped to their contractor's clients OR their own contractor.
-- Allow client-admin and client-staff to see user_roles scoped to their client.
CREATE POLICY user_roles_staff_select ON user_roles
  FOR SELECT
  USING (
    (
      -- Contractor-tier admins: see roles for their contractor or any of their clients
      current_user_role() IN ('contractor-admin', 'contractor-staff')
      AND (
        contractor_id = current_user_contractor_id()
        OR client_id IN (SELECT accessible_client_ids())
      )
    )
    OR
    (
      -- Client-tier admins: see roles scoped to their own client
      current_user_role() IN ('client-admin', 'client-staff')
      AND client_id = current_user_client_id()
    )
  );

-- Broaden profiles_staff_select to include ALL profiles that have a user_role
-- visible to the current admin (not just staff-tier roles).
DROP POLICY IF EXISTS profiles_staff_select ON profiles;

CREATE POLICY profiles_staff_select ON profiles
  FOR SELECT
  USING (
    (is_client_staff() OR is_contractor_user())
    AND id IN (
      SELECT ur.user_id FROM user_roles ur
      WHERE ur.is_active = true
      AND (
        (
          current_user_role() IN ('contractor-admin', 'contractor-staff')
          AND (
            ur.contractor_id = current_user_contractor_id()
            OR ur.client_id IN (SELECT accessible_client_ids())
          )
        )
        OR
        (
          current_user_role() IN ('client-admin', 'client-staff')
          AND ur.client_id = current_user_client_id()
        )
      )
    )
  );
