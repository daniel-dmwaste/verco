-- Fix accessible_client_ids() for multi-tenant contractors
-- The CASE expression used a scalar subquery that breaks when a contractor
-- has more than one client (error 21000: "more than one row returned by a
-- subquery used as an expression"). Rewrite to return a proper set.

CREATE OR REPLACE FUNCTION accessible_client_ids()
RETURNS SETOF uuid AS $$
  SELECT id FROM client
  WHERE
    (is_contractor_user() AND contractor_id = current_user_contractor_id())
    OR
    (NOT is_contractor_user() AND id = current_user_client_id());
$$ LANGUAGE sql SECURITY DEFINER STABLE;
