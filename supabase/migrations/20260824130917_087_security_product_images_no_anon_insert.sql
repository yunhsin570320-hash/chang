-- F5: uploads now go through the product-image edge function, which validates the
-- app session server-side and writes with the service role. The browser must no
-- longer be able to write into the product-images bucket with the public anon key.
DROP POLICY IF EXISTS "product_images_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_images_authenticated_insert" ON storage.objects;