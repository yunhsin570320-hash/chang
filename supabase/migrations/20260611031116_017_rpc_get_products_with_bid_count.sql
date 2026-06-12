-- RPC: 一次 JOIN 取得競拍商品 + 每個商品的出價數
-- 取代前端兩次串行查詢（get products → get bids），單一 round-trip

CREATE OR REPLACE FUNCTION get_auction_products()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT json_agg(row_order)
      FROM (
        SELECT
          json_build_object(
            'id',              p.id,
            'name',            p.name,
            'description',     p.description,
            'image_url',       p.image_url,
            'seller_id',       p.seller_id,
            'end_time',        p.end_time,
            'status',          p.status,
            'winner_id',       p.winner_id,
            'winning_amount',  p.winning_amount,
            'is_flagged',      p.is_flagged,
            'flag_reason',     p.flag_reason,
            'is_approved',     p.is_approved,
            'reserve_price',   p.reserve_price,
            'is_direct_buy',   p.is_direct_buy,
            'direct_price',    p.direct_price,
            'stock_quantity',  p.stock_quantity,
            'created_at',      p.created_at,
            'seller',          json_build_object('id', s.id, 'name', s.name),
            'bid_count',       COUNT(b.id)
          ) AS row_order
        FROM products p
        LEFT JOIN profiles s ON s.id = p.seller_id
        LEFT JOIN bids b ON b.product_id = p.id
        WHERE p.is_approved = true
          AND (p.is_direct_buy = false OR p.is_direct_buy IS NULL)
        GROUP BY p.id, p.name, p.description, p.image_url, p.seller_id,
                 p.end_time, p.status, p.winner_id, p.winning_amount,
                 p.is_flagged, p.flag_reason, p.is_approved, p.reserve_price,
                 p.is_direct_buy, p.direct_price, p.stock_quantity, p.created_at,
                 s.id, s.name
        ORDER BY p.created_at DESC
      ) sub
    ),
    '[]'::json
  );
$$;

-- RPC: 一次取得直購商品（含賣家資訊）
CREATE OR REPLACE FUNCTION get_direct_products()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT json_agg(row_order)
      FROM (
        SELECT
          json_build_object(
            'id',              p.id,
            'name',            p.name,
            'description',     p.description,
            'image_url',       p.image_url,
            'seller_id',       p.seller_id,
            'end_time',        p.end_time,
            'status',          p.status,
            'winner_id',       p.winner_id,
            'winning_amount',  p.winning_amount,
            'is_flagged',      p.is_flagged,
            'flag_reason',     p.flag_reason,
            'is_approved',     p.is_approved,
            'reserve_price',   p.reserve_price,
            'is_direct_buy',   p.is_direct_buy,
            'direct_price',    p.direct_price,
            'stock_quantity',  p.stock_quantity,
            'created_at',      p.created_at,
            'seller',          json_build_object('id', s.id, 'name', s.name)
          ) AS row_order
        FROM products p
        LEFT JOIN profiles s ON s.id = p.seller_id
        WHERE p.is_approved = true
          AND p.is_direct_buy = true
        ORDER BY p.created_at DESC
      ) sub
    ),
    '[]'::json
  );
$$;

GRANT EXECUTE ON FUNCTION get_auction_products() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_direct_products() TO anon, authenticated;
