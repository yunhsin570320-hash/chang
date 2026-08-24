/*
  # F15 — Product photos can no longer be overwritten or deleted by outside accounts

  `product_images_authenticated_update` and `product_images_authenticated_delete` were
  `USING (bucket_id = 'product-images')` with no owner predicate, so any holder of a
  Supabase Auth token could replace or delete every listing photo in the bucket.

  Product images are uploaded by the app and by the service-role migration function;
  neither needs a client-side update or delete path, so both policies are removed.
  Public read and the insert policy are left in place.
*/

DROP POLICY IF EXISTS "product_images_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "product_images_authenticated_delete" ON storage.objects;
