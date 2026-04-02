-- Add new status values to both NCN and NP enums
ALTER TYPE ncn_status ADD VALUE 'Issued';
ALTER TYPE ncn_status ADD VALUE 'Disputed';
ALTER TYPE ncn_status ADD VALUE 'Closed';

ALTER TYPE np_status ADD VALUE 'Issued';
ALTER TYPE np_status ADD VALUE 'Disputed';
ALTER TYPE np_status ADD VALUE 'Closed';

-- Change default status for new records from 'Open' to 'Issued'
ALTER TABLE non_conformance_notice ALTER COLUMN status SET DEFAULT 'Issued';
ALTER TABLE nothing_presented ALTER COLUMN status SET DEFAULT 'Issued';

-- Migrate existing 'Open' records to 'Issued'
UPDATE non_conformance_notice SET status = 'Issued' WHERE status = 'Open';
UPDATE nothing_presented SET status = 'Issued' WHERE status = 'Open';

-- Resident UPDATE policy for NCN dispute (Issued → Disputed only, own bookings)
CREATE POLICY ncn_resident_update_dispute ON non_conformance_notice FOR UPDATE
  USING (
    status = 'Issued'
    AND booking_id IN (
      SELECT id FROM booking WHERE contact_id = current_user_contact_id()
    )
  )
  WITH CHECK (
    status = 'Disputed'
  );

-- Resident UPDATE policy for NP dispute (Issued → Disputed only, own bookings)
CREATE POLICY np_resident_update_dispute ON nothing_presented FOR UPDATE
  USING (
    status = 'Issued'
    AND booking_id IN (
      SELECT id FROM booking WHERE contact_id = current_user_contact_id()
    )
  )
  WITH CHECK (
    status = 'Disputed'
  );
