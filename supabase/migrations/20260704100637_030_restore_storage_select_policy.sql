/*
  # Storage SELECT 정책 복원
  Supabase Storage의 upsert 업로드는 내부적으로 SELECT를 먼저 실행합니다.
  SELECT 정책이 없으면 upsert가 RLS 오류를 반환합니다.
  product-images는 공개 버킷이므로 SELECT 정책 복원이 허용됩니다.
*/

DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
CREATE POLICY "product_images_select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-images');
