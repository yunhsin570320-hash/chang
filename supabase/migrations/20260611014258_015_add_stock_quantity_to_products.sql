ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 1;
COMMENT ON COLUMN products.stock_quantity IS '直購廳庫存數量';
