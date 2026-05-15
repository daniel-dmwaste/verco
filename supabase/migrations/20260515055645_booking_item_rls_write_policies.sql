-- booking_item RLS write policies for staff roles.
--
-- Problem: booking_item had RLS enabled but only a SELECT policy. The admin
-- "edit collection date" form calls `supabase.from('booking_item').update(...)`
-- with the authenticated cookie-session client. With no UPDATE policy,
-- Postgres silently rejects (zero rows affected, `{error: null}` returned).
-- The action returns ok: true, the UI shows "saved", but the DB never
-- changes. No audit log entry fires because no row is actually updated.
--
-- Same class of bug as PR #32 (yesterday) on client / sub_client /
-- collection_area. CLAUDE.md §21 already documents the silent-fail pattern;
-- this is another instance of it that slipped through.
--
-- Resident booking creation goes through create-booking EF using service
-- role (still works — service role bypasses RLS). Cancellation flows go
-- through state-machine triggers on booking, not booking_item directly.
-- So adding UPDATE-only here doesn't break any existing path.

CREATE POLICY booking_item_staff_update ON booking_item
  FOR UPDATE
  TO authenticated
  USING (
    current_user_role() IN (
      'contractor-admin',
      'contractor-staff',
      'client-admin',
      'client-staff'
    )
    AND EXISTS (
      -- Cross-check: parent booking must be in the user's accessible set.
      -- The booking_select policy scopes booking by accessible_client_ids(),
      -- so an EXISTS here cascades that tenant scope to booking_item.
      SELECT 1 FROM booking WHERE booking.id = booking_item.booking_id
    )
  )
  WITH CHECK (
    current_user_role() IN (
      'contractor-admin',
      'contractor-staff',
      'client-admin',
      'client-staff'
    )
    AND EXISTS (
      SELECT 1 FROM booking WHERE booking.id = booking_item.booking_id
    )
  );
