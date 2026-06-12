/*
  # Archive Completed Deliveries

  1. Modified Tables
    - `products`
      - `is_archived` (boolean, default false) — 已完成交付並封存，不再顯示於主列表
    - `deliveries`
      - `completed_summary` (text, nullable) — 完成交付時自動產生的文字摘要
      - `completed_at` (timestamptz, nullable) — 完成時間

  2. Purpose
    - 已結標且已完成交付的商品以文字摘要方式存放，減少主介面資料量
    - 賣家後台主列表只顯示進行中（競標中、待交付、流標），完成交付自動移入封存區
    - 封存區以輕量純文字清單顯示，不載入圖片等重資料
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'is_archived') THEN
    ALTER TABLE products ADD COLUMN is_archived boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deliveries' AND column_name = 'completed_summary') THEN
    ALTER TABLE deliveries ADD COLUMN completed_summary text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deliveries' AND column_name = 'completed_at') THEN
    ALTER TABLE deliveries ADD COLUMN completed_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_is_archived ON products(is_archived);
CREATE INDEX IF NOT EXISTS idx_products_seller_archived ON products(seller_id, is_archived);
