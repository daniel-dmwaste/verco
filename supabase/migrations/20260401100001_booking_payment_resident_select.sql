-- Allow residents to read their own booking payments (for receipt URL display)
CREATE POLICY booking_payment_resident_select ON booking_payment
  FOR SELECT
  USING (
    booking_id IN (
      SELECT b.id FROM booking b
      WHERE b.contact_id = current_user_contact_id()
         OR b.contact_id = current_user_contact_id_by_email()
    )
  );

-- Allow staff to read booking payments for bookings in their scope
CREATE POLICY booking_payment_staff_select ON booking_payment
  FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (
      current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff')
    )
  );
