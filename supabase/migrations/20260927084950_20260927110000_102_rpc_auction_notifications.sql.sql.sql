/*
# Fix: RPC for auction end notifications

## Problem
sendAuctionNotifications() in lib/supabase.ts does a direct
notifications INSERT, which is blocked by RLS (notifications insert
was revoked in migration 027).

## Fix
New SECURITY DEFINER RPC that sends win/loss notifications to all
bidders of an ended auction. Called by the seller after ending.
*/
CREATE OR REPLACE FUNCTION public.rpc_send_auction_notifications(
  p_token       TEXT,
  p_product_id  UUID,
  p_winner_id   UUID,
  p_winning_amount BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_product products%ROWTYPE;
  v_bidder_ids UUID[];
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '找不到此商品');
  END IF;

  -- Only the seller can trigger notifications
  IF v_product.seller_id != v_user_id THEN
    RETURN jsonb_build_object('error', '無權限');
  END IF;

  -- Collect distinct bidder ids
  SELECT array_agg(DISTINCT b.bidder_id) INTO v_bidder_ids
  FROM bids b
  WHERE b.product_id = p_product_id;

  IF v_bidder_ids IS NOT NULL THEN
    INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
    SELECT
      bid,
      p_product_id,
      CASE WHEN bid = p_winner_id THEN 'won' ELSE 'lost' END,
      CASE WHEN bid = p_winner_id THEN '恭喜您得標！' ELSE '競標結果通知' END,
      CASE WHEN bid = p_winner_id
        THEN '您以 NT$ ' || COALESCE(p_winning_amount, 0)::TEXT || ' 成功得標「' || v_product.name || '」，請等候賣家聯繫交付事宜。'
        ELSE '很遺憾，您未能得標「' || v_product.name || '」，感謝您的參與。'
      END,
      false
    FROM unnest(v_bidder_ids) AS bid;
  END IF;

  RETURN jsonb_build_object('success', true, 'bidder_ids', COALESCE(v_bidder_ids, ARRAY[]::uuid[]));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_auction_notifications(TEXT, UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
