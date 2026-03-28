-- Allow staff users to read other staff profiles for "assign to" dropdowns.
-- The existing profiles_select policy only allows users to see their own profile.
-- This policy lets staff see profiles that have an active staff-tier role.

CREATE POLICY profiles_staff_select ON profiles FOR SELECT
  USING (
    (is_client_staff() OR is_contractor_user())
    AND id IN (
      SELECT user_id FROM user_roles
      WHERE role IN ('client-admin', 'client-staff', 'contractor-admin', 'contractor-staff')
        AND is_active = true
    )
  );
