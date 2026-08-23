-- ============================================================
-- Storage bucket policies for product-images
-- ============================================================
-- Current issues:
--   - INSERT policy has no WITH CHECK (anyone can upload to any bucket)
--   - DELETE/UPDATE allowed for anon (should be authenticated only)
--   - SELECT restricted to authenticated (correct, but let's verify)
--
-- Fix: only authenticated users can upload/delete/update product images.
-- Anon can only read (SELECT) public product images for display.

-- Drop all existing product-images policies
DROP POLICY IF EXISTS "product_images_delete" ON storage.objects;
DROP POLICY IF EXISTS "product_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
DROP POLICY IF EXISTS "product_images_update" ON storage.objects;

-- SELECT: anyone can view product images (they're public for display)
CREATE POLICY "product_images_public_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'product-images');

-- INSERT: only authenticated users can upload
CREATE POLICY "product_images_authenticated_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

-- UPDATE: only authenticated users can update their own uploads
CREATE POLICY "product_images_authenticated_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images')
WITH CHECK (bucket_id = 'product-images');

-- DELETE: only authenticated users can delete
CREATE POLICY "product_images_authenticated_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'product-images');
