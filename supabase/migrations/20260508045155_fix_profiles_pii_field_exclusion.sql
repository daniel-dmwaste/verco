-- Fix PII suppression on profiles: field role must NOT read other staff profiles.
--
-- Bug: profiles_staff_select used is_contractor_user() which returns true for
-- 'field' role (see is_contractor_user() definition — includes 'field'). That
-- means field users could read every staff profile in their contractor scope,
-- including full_name and email.
--
-- Per CLAUDE.md §4 (PII rule, absolute, no exceptions): field and ranger roles
-- must receive ZERO contact info. profiles is contact-adjacent — full_name and
-- email are PII.
--
-- Fix follows the pattern from 20260329110000_fix_pii_field_role_exclusion:
-- replace is_contractor_user() with explicit current_user_role() IN (...)
-- excluding 'field'. is_client_staff() is already field-safe (only includes
-- client-admin and client-staff) but we make the role check explicit for
-- consistency with the rest of the predicate.

DROP POLICY IF EXISTS profiles_staff_select ON profiles;

CREATE POLICY profiles_staff_select ON profiles
  FOR SELECT
  USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
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
