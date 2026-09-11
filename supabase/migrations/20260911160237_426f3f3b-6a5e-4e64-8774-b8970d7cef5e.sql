-- 0045: close the storage write hole.
--
-- The three prior policies were PERMISSIVE with inverted conditions
-- (bucket_id <> 'public-assets'), which GRANTED insert/update/delete on every
-- OTHER bucket -- including the private customer-attachments bucket -- to anon
-- and authenticated. Replace them with explicit allow-rules.

DROP POLICY IF EXISTS "Deny public insert public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Deny public update public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Deny public delete public-assets" ON storage.objects;

-- Read: only the public-assets bucket (logos, bot avatar, knowledge sync file).
-- customer-attachments stays unreadable via the Data API; the `attachment`
-- edge function mints signed URLs with the service role.
CREATE POLICY "public_assets_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'public-assets');

-- Write: admins only, and only into public-assets.
CREATE POLICY "public_assets_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'public-assets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "public_assets_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'public-assets' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'public-assets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "public_assets_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'public-assets' AND public.has_role(auth.uid(), 'admin'));