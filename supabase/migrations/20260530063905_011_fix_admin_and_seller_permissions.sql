/*
  # 修復管理員與賣家權限

  ## 問題說明
  1. products 表缺少 DELETE 政策 → 賣家和管理員無法刪除商品
  2. products UPDATE 政策不允許管理員操作 → 管理員無法標記/下架商品
  3. profiles UPDATE 政策只允許自己更新 → 管理員無法封鎖/警告用戶

  ## 修復內容
  1. 新增 products DELETE 政策：賣家可刪除自己商品，管理員可刪除任何商品
  2. 新增 products UPDATE 管理員政策：管理員可更新任何商品（標記、下架等）
  3. 新增 profiles UPDATE 管理員政策：管理員可更新任何用戶資料（封鎖、警告等）
*/

-- 1. 賣家可刪除自己的商品
CREATE POLICY "Sellers can delete own products"
  ON products FOR DELETE
  TO authenticated
  USING (seller_id = auth.uid());

-- 2. 管理員可刪除任何商品
CREATE POLICY "Admins can delete any product"
  ON products FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 3. 管理員可更新任何商品（標記、核准、結標等）
CREATE POLICY "Admins can update any product"
  ON products FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 4. 管理員可更新任何用戶資料（封鎖、警告次數等）
CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );
