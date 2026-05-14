-- Private bucket for bug-report attachments (screenshots from the FAB form).
-- Path convention (app-enforced):
--   bug-report-attachments/<bug_report_id>/<uuid>-<original_filename>
--
-- Access via signed URLs. 10 MB limit; image + PDF MIME allowlist.
-- Discovery is gated by which bug_report rows the user can SELECT (RLS on
-- bug_report restricts to staff roles + tenant scope).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bug-report-attachments',
  'bug-report-attachments',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Staff read
DROP POLICY IF EXISTS bug_report_attachments_staff_read ON storage.objects;
CREATE POLICY bug_report_attachments_staff_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'bug-report-attachments'
    AND current_user_role() IN (
      'contractor-admin', 'contractor-staff',
      'client-admin', 'client-staff'
    )
  );

-- Staff write
DROP POLICY IF EXISTS bug_report_attachments_staff_insert ON storage.objects;
CREATE POLICY bug_report_attachments_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bug-report-attachments'
    AND current_user_role() IN (
      'contractor-admin', 'contractor-staff',
      'client-admin', 'client-staff'
    )
  );

-- Staff delete (cleanup if bug_report is removed)
DROP POLICY IF EXISTS bug_report_attachments_staff_delete ON storage.objects;
CREATE POLICY bug_report_attachments_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'bug-report-attachments'
    AND current_user_role() IN (
      'contractor-admin', 'contractor-staff',
      'client-admin', 'client-staff'
    )
  );
