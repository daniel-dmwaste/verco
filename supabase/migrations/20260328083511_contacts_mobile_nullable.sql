-- Make contacts.mobile_e164 nullable.
-- Service tickets can be submitted without a mobile number (email-only contact).
-- Booking creation still validates mobile via zod schema before insert.
ALTER TABLE contacts ALTER COLUMN mobile_e164 DROP NOT NULL;
