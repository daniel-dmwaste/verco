-- Add INSERT/UPDATE/DELETE policies to client table.
--
-- The client table had RLS enabled (initial_schema.sql:949) and SELECT
-- policies for admins (initial_schema.sql:1016) plus a public-read for
-- proxy tenant resolution (public_read_policies.sql:14), but NO write
-- policies. Every UPDATE from the admin branding form was silently
-- denied by RLS, with .update() returning {error: null, data: null}
-- (because the action did not chain .select()). Server action returned
-- ok:true, banner showed "Changes saved.", but on refresh the row
-- read back the unchanged value. CLAUDE.md §21 — RLS write silent-fail.
--
-- Same gap meant createNewClient (also in admin clients/actions.ts)
-- silently failed; existing clients were only present because they
-- were seeded via service-role migrations.

-- contractor-admin: full write across own contractor's clients.
CREATE POLICY client_contractor_admin_insert ON client FOR INSERT
  WITH CHECK (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  );

CREATE POLICY client_contractor_admin_update ON client FOR UPDATE
  USING (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  )
  WITH CHECK (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  );

CREATE POLICY client_contractor_admin_delete ON client FOR DELETE
  USING (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  );

-- client-admin: UPDATE own client only (branding, contact, content slots).
-- WITH CHECK pins id = current_user_client_id() so they cannot reassign
-- to another client. contractor_id is not pinned here because the admin
-- update form does not expose it; if that changes, tighten the CHECK.
CREATE POLICY client_client_admin_update ON client FOR UPDATE
  USING (
    has_role('client-admin')
    AND id = current_user_client_id()
  )
  WITH CHECK (
    has_role('client-admin')
    AND id = current_user_client_id()
  );
