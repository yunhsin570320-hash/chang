/*
  # 新增底價欄位與修正商品核准邏輯

  1. 變更
    - products 表新增 reserve_price 欄位（底價，預設 0）
    - 現有商品的 reserve_price 設為 0

  2. 說明
    - reserve_price = 0 表示無底價限制，任何金額均可出價
    - reserve_price > 0 表示出價金額必須 >= reserve_price 才能成立
    - 新商品上架時 is_approved 預設為 false，需管理員核准才出現在競標大廳
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'reserve_price'
  ) THEN
    ALTER TABLE products ADD COLUMN reserve_price integer NOT NULL DEFAULT 0;
  END IF;
END $$;
