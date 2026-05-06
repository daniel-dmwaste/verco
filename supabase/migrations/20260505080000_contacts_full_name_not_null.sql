-- Mark contacts.full_name NOT NULL.
--
-- The generated expression TRIM(first_name || ' ' || last_name) is
-- mathematically non-null because both inputs are NOT NULL. Postgres knows
-- this at runtime (no row will ever have a null full_name) but the
-- supabase CLI infers nullability from the column metadata, not the
-- expression. Adding the explicit constraint flips the inferred type from
-- `string | null` to `string` in the regenerated TS types and matches
-- pre-split behaviour for every read-path consumer.

ALTER TABLE contacts ALTER COLUMN full_name SET NOT NULL;
