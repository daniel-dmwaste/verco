-- Client assets storage bucket (logos, banners)
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-assets', 'client-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for all
CREATE POLICY "client_assets_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'client-assets');

-- Authenticated users can upload
CREATE POLICY "client_assets_auth_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'client-assets');

-- Authenticated users can update their uploads
CREATE POLICY "client_assets_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'client-assets');

-- Authenticated users can delete their uploads
CREATE POLICY "client_assets_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'client-assets');
