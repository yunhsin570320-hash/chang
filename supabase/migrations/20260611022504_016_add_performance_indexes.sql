-- Speed up product listing queries
CREATE INDEX IF NOT EXISTS idx_products_is_approved_status ON products (is_approved, status);
CREATE INDEX IF NOT EXISTS idx_products_is_direct_buy ON products (is_direct_buy) WHERE is_direct_buy = true;
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products (seller_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at DESC);

-- Speed up bid count lookups
CREATE INDEX IF NOT EXISTS idx_bids_product_id ON bids (product_id);

-- Speed up notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read ON notifications (user_id, is_read);
