/*
  # 修補剩餘安全問題
  1. get_auction_products / get_direct_products — 移除 SECURITY DEFINER（只讀公開表），加 search_path
  2. app_get_user_id / app_is_admin — 撤銷 anon/authenticated 的直接執行權
  3. notifications UPDATE — 改用 RPC rpc_mark_notifications_read
  4. storage product_images_select — 移除廣泛 SELECT 政策（公開桶不需要它）
  5. app_sessions — 新增明確拒絕政策消除「無政策」警告
*/

-- ============================================================
-- 1. 移除 SECURITY DEFINER + 固定 search_path
--    (這兩個函式只讀公開表，不需要 SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION get_auction_products()
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
SELECT COALESCE(
  (
    SELECT json_agg(t ORDER BY t.created_at DESC)
    FROM (
      SELECT
        p.id, p.name, p.description, p.image_url, p.seller_id,
        p.end_time, p.status, p.winner_id, p.winning_amount,
        p.created_at, p.is_flagged, p.flag_reason, p.is_approved,
        p.is_archived, p.reserve_price, p.is_direct_buy,
        p.direct_price, p.stock_quantity,
        json_build_object('id', s.id, 'name', s.name) AS seller,
        (SELECT COUNT(*)::integer FROM bids b WHERE b.product_id = p.id) AS bid_count
      FROM products p
      LEFT JOIN profiles s ON s.id = p.seller_id
      WHERE p.is_approved = true
        AND (p.is_direct_buy = false OR p.is_direct_buy IS NULL)
    ) t
  ),
  '[]'::json
);
$$;

CREATE OR REPLACE FUNCTION get_direct_products()
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
SELECT COALESCE(
  (
    SELECT json_agg(t ORDER BY t.created_at DESC)
    FROM (
      SELECT
        p.id, p.name, p.description, p.image_url, p.seller_id,
        p.end_time, p.status, p.winner_id, p.winning_amount,
        p.created_at, p.is_flagged, p.flag_reason, p.is_approved,
        p.is_archived, p.reserve_price, p.is_direct_buy,
        p.direct_price, p.stock_quantity,
        json_build_object('id', s.id, 'name', s.name) AS seller,
        CASE WHEN p.winner_id IS NOT NULL
          THEN json_build_object('id', w.id, 'name', w.name)
          ELSE NULL
        END AS winner
      FROM products p
      LEFT JOIN profiles s ON s.id = p.seller_id
      LEFT JOIN profiles w ON w.id = p.winner_id
      WHERE p.is_approved = true
        AND p.is_direct_buy = true
    ) t
  ),
  '[]'::json
);
$$;

-- ============================================================
-- 2. 撤銷 helper 函式的公開執行權
--    (這兩個只用於其他 SECURITY DEFINER 函式的內部呼叫)
-- ============================================================

REVOKE EXECUTE ON FUNCTION app_get_user_id(TEXT)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_is_admin(UUID)     FROM anon, authenticated;

-- ============================================================
-- 3. Notifications UPDATE — 移除開放政策，改走 RPC
-- ============================================================

DROP POLICY IF EXISTS "Anyone can update notifications" ON notifications;

CREATE OR REPLACE FUNCTION rpc_mark_notifications_read(
  p_token          TEXT,
  p_all            BOOLEAN DEFAULT false,
  p_notification_id UUID    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

  IF p_all THEN
    UPDATE notifications SET is_read = true
    WHERE user_id = v_user_id AND is_read = false;
  ELSIF p_notification_id IS NOT NULL THEN
    UPDATE notifications SET is_read = true
    WHERE id = p_notification_id AND user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 4. Storage — 移除允許列出所有檔案的廣泛 SELECT 政策
--    (公開桶透過 URL 直接存取不需要 SELECT 政策)
-- ============================================================

DROP POLICY IF EXISTS "product_images_select" ON storage.objects;

-- ============================================================
-- 5. app_sessions — 明確拒絕政策（消除「無政策」警告）
-- ============================================================

CREATE POLICY "no_direct_access"
  ON app_sessions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
