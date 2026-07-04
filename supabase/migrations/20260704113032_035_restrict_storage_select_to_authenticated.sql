-- Public bucket direct URL access bypasses RLS entirely and does not need a SELECT policy.
-- The SELECT policy is only needed by authenticated users for the upload flow internals.
-- Removing anon from SELECT prevents unauthenticated clients from listing all stored files.
DROP POLICY IF EXISTS "product_images_select" ON storage.objects;

CREATE POLICY "product_images_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'product-images');
