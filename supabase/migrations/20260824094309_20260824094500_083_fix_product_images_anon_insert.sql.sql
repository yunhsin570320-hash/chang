-- Fix: product-images storage INSERT policy only allows "authenticated" role,
-- but this app uses a custom auth system (not Supabase Auth), so all client
-- requests use the anon key. Anon users cannot upload product images, which
-- causes product creation to silently fail at the image upload step.
--
-- Add an INSERT policy for the anon role so the anon-key client can upload.

CREATE POLICY "product_images_anon_insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'product-images');
