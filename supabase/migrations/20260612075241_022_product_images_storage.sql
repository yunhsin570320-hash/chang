/*
# Create Product Images Storage Bucket

1. Changes
   - Creates a public storage bucket named `product-images` for storing product photos
   - Images uploaded here are publicly readable via URL (no auth required to view)
   - Authenticated and anon users can upload, update, and delete (to allow sellers to manage their listings)

2. Why
   - Previously, product images were stored as base64 strings directly in the `products.image_url` column
   - A single base64-encoded photo is 2–3.5 MB; with 26 products that is ~70 MB per query, which exceeds the Supabase statement timeout
   - Storing images in object storage means `image_url` holds only a short URL string (<200 bytes), making all list queries fast again

3. Security
   - Public read: anyone (anon) can view product images via the public URL — this is intentional since products are publicly listed
   - Uploads allowed to anon + authenticated so the custom-auth system (which does not use Supabase Auth) can write images
*/

-- Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage object policies
DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
CREATE POLICY "product_images_select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product_images_insert" ON storage.objects;
CREATE POLICY "product_images_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product_images_update" ON storage.objects;
CREATE POLICY "product_images_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product_images_delete" ON storage.objects;
CREATE POLICY "product_images_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'product-images');
