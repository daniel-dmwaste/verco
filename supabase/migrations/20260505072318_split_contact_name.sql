-- Split contacts.full_name into first_name + last_name.
--
-- Driver: residents leave the single name field with only "John" or "Sarah".
-- Two independently-required fields (enforced at app-layer zod with min(1))
-- force both names at point of entry.
--
-- full_name is preserved as a GENERATED column so the ~25 read paths
-- (admin display, audit timeline, email templates, FK resolver, run sheet)
-- continue to work without changes. Only write paths must change because
-- Postgres rejects INSERT/UPDATE on generated columns.
--
-- Backfill strategy: best-effort split on first space.
--   "Jane"            -> first_name='Jane',  last_name=''
--   "Jane Smith"      -> first_name='Jane',  last_name='Smith'
--   "Van Der Berg"    -> first_name='Van',   last_name='Der Berg'
-- Single-name legacy records get last_name='' and are tolerated by the DB
-- (DEFAULT '' on the column). New entries are enforced as non-empty by
-- app-layer zod, NOT a CHECK constraint, so updates to legacy rows for
-- unrelated fields (e.g. mobile) won't suddenly be rejected.

-- 1. Add the new columns. DEFAULT '' lets ADD COLUMN NOT NULL succeed
--    on existing rows; the UPDATE below replaces those defaults with
--    real data split from full_name.
ALTER TABLE contacts
  ADD COLUMN first_name text NOT NULL DEFAULT '',
  ADD COLUMN last_name  text NOT NULL DEFAULT '';

-- 2. Backfill from existing full_name. trim() handles leading/trailing
--    whitespace; split_part returns the first space-delimited token;
--    the substring expression returns everything after the first space,
--    or '' if there is no space.
UPDATE contacts SET
  first_name = split_part(trim(full_name), ' ', 1),
  last_name  = COALESCE(
    NULLIF(
      substring(trim(full_name) FROM position(' ' IN trim(full_name)) + 1),
      ''
    ),
    ''
  )
WHERE full_name IS NOT NULL;

-- 3. Replace full_name with a generated column.
--    Postgres can't ALTER an existing column to GENERATED -- must drop
--    and re-add with the same name so all read paths keep working.
ALTER TABLE contacts DROP COLUMN full_name;

ALTER TABLE contacts ADD COLUMN full_name text
  GENERATED ALWAYS AS (TRIM(first_name || ' ' || last_name)) STORED;

-- 4. Documentation
COMMENT ON COLUMN contacts.first_name IS 'Required at app layer (min 1 char). Legacy backfilled records may have empty value but are not rejected on update.';
COMMENT ON COLUMN contacts.last_name  IS 'Required at app layer (min 1 char). Legacy backfilled records (single-name entries from old form) may have empty value.';
COMMENT ON COLUMN contacts.full_name  IS 'Generated from TRIM(first_name || '' '' || last_name). Read-only -- INSERT/UPDATE will fail. Preserved for backward compatibility with admin display, email templates, audit log FK resolver.';
