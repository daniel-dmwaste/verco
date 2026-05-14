-- Bug-report intake. Pivots off Studio-drift work that landed an empty
-- `bug_report` table + 2 unfinished policies + 3 enums in prod outside git.
-- This migration aligns the table with the documented design:
--   1. ADD description column (was missing)
--   2. ADD sequence-backed default on display_id (BR-NNNN)
--   3. CREATE the missing bug_report_attachment + bug_report_comment tables
--   4. REPLACE the open-to-all policies with role-gated ones
--   5. ATTACH audit triggers (CLAUDE.md §21)
--   6. ADD performance indexes

-- ─── Sequence + display_id default ────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS bug_report_number_seq;

ALTER TABLE bug_report
  ALTER COLUMN display_id SET DEFAULT (
    'BR-' || lpad(nextval('bug_report_number_seq')::text, 4, '0')
  );

-- description was omitted from the Studio-applied table.
ALTER TABLE bug_report
  ADD COLUMN IF NOT EXISTS description text
  CHECK (description IS NULL OR char_length(description) <= 4000);

-- title length cap matches the in-form zod
ALTER TABLE bug_report
  DROP CONSTRAINT IF EXISTS bug_report_title_check;
ALTER TABLE bug_report
  ADD CONSTRAINT bug_report_title_check CHECK (char_length(title) <= 150);

-- Make display_id unique-not-null friendly with the sequence default.
-- bug_report_display_id_key already exists (unique index); leave as-is.

-- updated_at trigger (the table has updated_at column but no trigger)
DROP TRIGGER IF EXISTS bug_report_updated_at ON bug_report;
CREATE TRIGGER bug_report_updated_at
  BEFORE UPDATE ON bug_report
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_bug_report_status        ON bug_report(status);
CREATE INDEX IF NOT EXISTS idx_bug_report_client_status ON bug_report(client_id, status);
CREATE INDEX IF NOT EXISTS idx_bug_report_reporter      ON bug_report(reporter_id);
CREATE INDEX IF NOT EXISTS idx_bug_report_linear_pending
  ON bug_report(created_at) WHERE status = 'new' AND linear_issue_id IS NULL;

-- ─── Attachment + comment tables (new) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS bug_report_attachment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_report_id uuid NOT NULL REFERENCES bug_report(id) ON DELETE CASCADE,
  file_path     text NOT NULL,
  file_name     text NOT NULL,
  file_type     text,
  file_size     integer CHECK (file_size IS NULL OR file_size <= 10485760),
  uploaded_by   uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bug_report_attachment_bug
  ON bug_report_attachment(bug_report_id);

CREATE TABLE IF NOT EXISTS bug_report_comment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_report_id uuid NOT NULL REFERENCES bug_report(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL REFERENCES auth.users(id),
  comment       text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 4000),
  is_internal   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bug_report_comment_bug
  ON bug_report_comment(bug_report_id, created_at);

ALTER TABLE bug_report_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_report_comment    ENABLE ROW LEVEL SECURITY;

-- ─── Role-gate helper (used by RLS) ────────────────────────────────────────
-- Distinct from is_contractor_user() which includes 'field' (PII red line).

CREATE OR REPLACE FUNCTION is_staff_role()
RETURNS boolean AS $$
  SELECT current_user_role() IN (
    'contractor-admin', 'contractor-staff',
    'client-admin', 'client-staff'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Replace the existing open-to-all policies ─────────────────────────────

DROP POLICY IF EXISTS bug_report_insert ON bug_report;
DROP POLICY IF EXISTS bug_report_select ON bug_report;
DROP POLICY IF EXISTS bug_report_staff_select ON bug_report;
DROP POLICY IF EXISTS bug_report_staff_insert ON bug_report;
DROP POLICY IF EXISTS bug_report_staff_update ON bug_report;

CREATE POLICY bug_report_staff_select ON bug_report FOR SELECT TO authenticated
  USING (
    is_staff_role()
    AND (client_id IS NULL OR client_id IN (SELECT accessible_client_ids()))
  );

CREATE POLICY bug_report_staff_insert ON bug_report FOR INSERT TO authenticated
  WITH CHECK (
    is_staff_role()
    AND reporter_id = auth.uid()
    AND (client_id IS NULL OR client_id IN (SELECT accessible_client_ids()))
  );

CREATE POLICY bug_report_staff_update ON bug_report FOR UPDATE TO authenticated
  USING (
    is_staff_role()
    AND (client_id IS NULL OR client_id IN (SELECT accessible_client_ids()))
  )
  WITH CHECK (
    is_staff_role()
    AND (client_id IS NULL OR client_id IN (SELECT accessible_client_ids()))
  );

-- ─── Policies on new tables ────────────────────────────────────────────────

DROP POLICY IF EXISTS bug_report_attachment_staff_select ON bug_report_attachment;
CREATE POLICY bug_report_attachment_staff_select ON bug_report_attachment FOR SELECT TO authenticated
  USING (
    is_staff_role()
    AND bug_report_id IN (
      SELECT id FROM bug_report
      WHERE client_id IS NULL OR client_id IN (SELECT accessible_client_ids())
    )
  );

DROP POLICY IF EXISTS bug_report_attachment_staff_insert ON bug_report_attachment;
CREATE POLICY bug_report_attachment_staff_insert ON bug_report_attachment FOR INSERT TO authenticated
  WITH CHECK (
    is_staff_role()
    AND uploaded_by = auth.uid()
    AND bug_report_id IN (
      SELECT id FROM bug_report
      WHERE client_id IS NULL OR client_id IN (SELECT accessible_client_ids())
    )
  );

DROP POLICY IF EXISTS bug_report_comment_staff_select ON bug_report_comment;
CREATE POLICY bug_report_comment_staff_select ON bug_report_comment FOR SELECT TO authenticated
  USING (
    is_staff_role()
    AND bug_report_id IN (
      SELECT id FROM bug_report
      WHERE client_id IS NULL OR client_id IN (SELECT accessible_client_ids())
    )
  );

DROP POLICY IF EXISTS bug_report_comment_staff_insert ON bug_report_comment;
CREATE POLICY bug_report_comment_staff_insert ON bug_report_comment FOR INSERT TO authenticated
  WITH CHECK (
    is_staff_role()
    AND author_id = auth.uid()
    AND bug_report_id IN (
      SELECT id FROM bug_report
      WHERE client_id IS NULL OR client_id IN (SELECT accessible_client_ids())
    )
  );

DROP POLICY IF EXISTS bug_report_comment_author_update ON bug_report_comment;
CREATE POLICY bug_report_comment_author_update ON bug_report_comment FOR UPDATE TO authenticated
  USING (is_staff_role() AND author_id = auth.uid())
  WITH CHECK (is_staff_role() AND author_id = auth.uid());

-- ─── Audit triggers ────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS bug_report_audit ON bug_report;
CREATE TRIGGER bug_report_audit
  AFTER INSERT OR UPDATE OR DELETE ON bug_report
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS bug_report_attachment_audit ON bug_report_attachment;
CREATE TRIGGER bug_report_attachment_audit
  AFTER INSERT OR UPDATE OR DELETE ON bug_report_attachment
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS bug_report_comment_audit ON bug_report_comment;
CREATE TRIGGER bug_report_comment_audit
  AFTER INSERT OR UPDATE OR DELETE ON bug_report_comment
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
