-- SELECT 政策已不需要：uploadProductImage 使用純 INSERT (upsert: false)，
-- 公開 bucket 的物件 URL 直接存取不依賴 RLS SELECT 政策。
DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
