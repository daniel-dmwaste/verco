-- Add INSERT/UPDATE/DELETE policies to client, sub_client, collection_area.
--
-- These three tables had RLS enabled (initial_schema.sql:949-951) with
-- SELECT policies only — no write policies. UPDATEs from admin server
-- actions (updateClient, updateClientFaqs, updateSubClient,
-- updateCollectionArea in src/app/(admin)/admin/clients/actions.ts)
-- were silently denied by RLS; .update() returned {error:null,data:null}
-- because the actions did not chain .select(). Server actions returned
-- ok:true and the UI showed success; refresh read back unchanged rows.
-- CLAUDE.md §21 — RLS write silent-fail.
--
-- The client-table bug was the user-visible symptom (Dan reported the
-- branding form revert). sub_client and collection_area had not been
-- exercised in production yet — same shape, same gap, same fix.
--
-- Defence-in-depth: the actions.ts changes in this PR add
-- .select('id').single() so future RLS gaps fail loud (PGRST116)
-- instead of silent success.

-- ─── client table ──────────────────────────────────────────────────────────

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

-- ─── sub_client table ──────────────────────────────────────────────────────

-- sub_client has no denormalised contractor_id; walk via client.contractor_id.
-- contractor-admin: full write across own contractor's sub_clients.
CREATE POLICY sub_client_contractor_admin_insert ON sub_client FOR INSERT
  WITH CHECK (
    has_role('contractor-admin')
    AND EXISTS (
      SELECT 1 FROM client
      WHERE client.id = sub_client.client_id
        AND client.contractor_id = current_user_contractor_id()
    )
  );

CREATE POLICY sub_client_contractor_admin_update ON sub_client FOR UPDATE
  USING (
    has_role('contractor-admin')
    AND EXISTS (
      SELECT 1 FROM client
      WHERE client.id = sub_client.client_id
        AND client.contractor_id = current_user_contractor_id()
    )
  )
  WITH CHECK (
    has_role('contractor-admin')
    AND EXISTS (
      SELECT 1 FROM client
      WHERE client.id = sub_client.client_id
        AND client.contractor_id = current_user_contractor_id()
    )
  );

CREATE POLICY sub_client_contractor_admin_delete ON sub_client FOR DELETE
  USING (
    has_role('contractor-admin')
    AND EXISTS (
      SELECT 1 FROM client
      WHERE client.id = sub_client.client_id
        AND client.contractor_id = current_user_contractor_id()
    )
  );

-- client-admin: full write on own client's sub_clients.
-- WITH CHECK pins client_id so a client-admin cannot reassign a sub_client
-- to a different parent client.
CREATE POLICY sub_client_client_admin_insert ON sub_client FOR INSERT
  WITH CHECK (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  );

CREATE POLICY sub_client_client_admin_update ON sub_client FOR UPDATE
  USING (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  )
  WITH CHECK (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  );

CREATE POLICY sub_client_client_admin_delete ON sub_client FOR DELETE
  USING (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  );

-- ─── collection_area table ─────────────────────────────────────────────────

-- collection_area has denormalised contractor_id and client_id; direct checks.
-- contractor-admin: full write across own contractor's areas.
CREATE POLICY collection_area_contractor_admin_insert ON collection_area FOR INSERT
  WITH CHECK (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  );

CREATE POLICY collection_area_contractor_admin_update ON collection_area FOR UPDATE
  USING (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  )
  WITH CHECK (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  );

CREATE POLICY collection_area_contractor_admin_delete ON collection_area FOR DELETE
  USING (
    has_role('contractor-admin')
    AND contractor_id = current_user_contractor_id()
  );

-- client-admin: full write on own client's areas.
-- WITH CHECK pins client_id so a client-admin cannot reassign an area
-- to a different client.
CREATE POLICY collection_area_client_admin_insert ON collection_area FOR INSERT
  WITH CHECK (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  );

CREATE POLICY collection_area_client_admin_update ON collection_area FOR UPDATE
  USING (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  )
  WITH CHECK (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  );

CREATE POLICY collection_area_client_admin_delete ON collection_area FOR DELETE
  USING (
    has_role('client-admin')
    AND client_id = current_user_client_id()
  );
