-- ============================================================================
-- MUD Module — Migration 5/6: Supabase Storage bucket for auth forms
-- ============================================================================
-- Creates a private bucket `mud-auth-forms` for storing the externally-signed
-- strata authorisation PDFs/images. Per the live-DB audit (2026-04-08) this is
-- the FIRST storage bucket in the project.
--
-- Path convention (enforced in app code, not SQL):
--   mud-auth-forms/<collection_area_id>/<property_id>/<uuid>-<original_filename>
--
-- Access via signed URLs (1-hour TTL) only — no public read.
-- 10 MB hard limit matches the brief. MIME allowlist prevents arbitrary uploads.
--
-- RLS: only authenticated staff can read or write. The actual scope check
-- (WMRC vs other clients) is delegated to the existing accessible_client_ids()
-- mechanism — staff can technically access any object in the bucket, but
-- discovery is gated by which property records they can SELECT, which IS
-- scoped by the existing eligible_properties RLS.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mud-auth-forms',
  'mud-auth-forms',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Staff read
DROP POLICY IF EXISTS mud_auth_forms_staff_read ON storage.objects;
CREATE POLICY mud_auth_forms_staff_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'mud-auth-forms'
    AND current_user_role() IN (
      'contractor-admin', 'contractor-staff',
      'client-admin', 'client-staff'
    )
  );

-- Staff write (initial upload)
DROP POLICY IF EXISTS mud_auth_forms_staff_insert ON storage.objects;
CREATE POLICY mud_auth_forms_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mud-auth-forms'
    AND current_user_role() IN (
      'contractor-admin', 'contractor-staff',
      'client-admin', 'client-staff'
    )
  );

-- Staff update (re-upload)
DROP POLICY IF EXISTS mud_auth_forms_staff_update ON storage.objects;
CREATE POLICY mud_auth_forms_staff_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'mud-auth-forms'
    AND current_user_role() IN (
      'contractor-admin', 'contractor-staff',
      'client-admin', 'client-staff'
    )
  );

-- Staff delete (cleanup on MUD deletion)
DROP POLICY IF EXISTS mud_auth_forms_staff_delete ON storage.objects;
CREATE POLICY mud_auth_forms_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'mud-auth-forms'
    AND current_user_role() IN (
      'contractor-admin', 'contractor-staff',
      'client-admin', 'client-staff'
    )
  );
