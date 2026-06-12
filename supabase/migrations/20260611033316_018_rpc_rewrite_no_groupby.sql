-- 重寫 RPC：改用相關子查詢取代 GROUP BY，消除 hash aggregation 超時
-- 改用 RETURNS TABLE 讓 PostgREST 原生序列化（更快更省記憶體）
-- plpgsql 允許 SET LOCAL statement_timeout 覆蓋 REST API 預設限制

DROP FUNCTION IF EXISTS get_auction_products();
DROP FUNCTION IF EXISTS get_direct_products();

CREATE OR REPLACE FUNCTION get_auction_products()
RETURNS TABLE (
  id             uuid,
  name           text,
  description    text,
  image_url      text,
  seller_id      uuid,
  end_time       timestamptz,
  status         text,
  winner_id      uuid,
  winning_amount integer,
  created_at     timestamptz,
  is_flagged     boolean,
  flag_reason    text,
  is_approved    boolean,
  is_archived    boolean,
  reserve_price  integer,
  is_direct_buy  boolean,
  direct_price   integer,
  stock_quantity integer,
  seller         json,
  bid_count      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  SET LOCAL statement_timeout = '10000';
  RETURN QUERY
    SELECT
      p.id,
      p.name,
      p.description,
      p.image_url,
      p.seller_id,
      p.end_time,
      p.status,
      p.winner_id,
      p.winning_amount,
      p.created_at,
      p.is_flagged,
      p.flag_reason,
      p.is_approved,
      p.is_archived,
      p.reserve_price,
      p.is_direct_buy,
      p.direct_price,
      p.stock_quantity,
      json_build_object('id', s.id, 'name', s.name) AS seller,
      (SELECT COUNT(*)::integer FROM bids b WHERE b.product_id = p.id) AS bid_count
    FROM products p
    LEFT JOIN profiles s ON s.id = p.seller_id
    WHERE p.is_approved = true
      AND (p.is_direct_buy = false OR p.is_direct_buy IS NULL)
    ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION get_direct_products()
RETURNS TABLE (
  id             uuid,
  name           text,
  description    text,
  image_url      text,
  seller_id      uuid,
  end_time       timestamptz,
  status         text,
  winner_id      uuid,
  winning_amount integer,
  created_at     timestamptz,
  is_flagged     boolean,
  flag_reason    text,
  is_approved    boolean,
  is_archived    boolean,
  reserve_price  integer,
  is_direct_buy  boolean,
  direct_price   integer,
  stock_quantity integer,
  seller         json
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  SET LOCAL statement_timeout = '10000';
  RETURN QUERY
    SELECT
      p.id,
      p.name,
      p.description,
      p.image_url,
      p.seller_id,
      p.end_time,
      p.status,
      p.winner_id,
      p.winning_amount,
      p.created_at,
      p.is_flagged,
      p.flag_reason,
      p.is_approved,
      p.is_archived,
      p.reserve_price,
      p.is_direct_buy,
      p.direct_price,
      p.stock_quantity,
      json_build_object('id', s.id, 'name', s.name) AS seller
    FROM products p
    LEFT JOIN profiles s ON s.id = p.seller_id
    WHERE p.is_approved = true
      AND p.is_direct_buy = true
    ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_auction_products() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_direct_products() TO anon, authenticated;
