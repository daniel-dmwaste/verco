-- Add receipt_url column to booking_payment for Stripe hosted receipt links
ALTER TABLE booking_payment ADD COLUMN receipt_url text;
