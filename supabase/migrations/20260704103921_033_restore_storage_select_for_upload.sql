-- Storage upload requires SELECT internally (to create folder entries in storage.objects).
-- Without this policy, uploads fail with RLS errors even with upsert:false.
DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
CREATE POLICY "product_images_select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-images');
