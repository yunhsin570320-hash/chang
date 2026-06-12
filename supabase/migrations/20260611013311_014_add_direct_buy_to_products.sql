ALTER TABLE products ADD COLUMN IF NOT EXISTS is_direct_buy boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS direct_price integer;
COMMENT ON COLUMN products.is_direct_buy IS '是否為直購商品';
COMMENT ON COLUMN products.direct_price IS '直購定價';
