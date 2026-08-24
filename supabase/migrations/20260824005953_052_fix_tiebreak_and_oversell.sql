/*
# Fix: Bid Tie-Breaking + Direct Buy Oversell Prevention

## Problem 1: Bid tie-breaking
rpc_seller_end_auction selects winner with `ORDER BY amount DESC LIMIT 1`
When two bidders bid the same amount, the winner is arbitrary (depends on
physical row order). Fix: break ties by earliest bid time (先出價者得標).

## Problem 2: Direct buy overselling
rpc_direct_buy reads stock into a variable, computes new_stock, then writes
that fixed value. Two concurrent buyers both read stock=5, both write 4.
One unit is oversold. Fix: decrement atomically with
`SET stock_quantity = stock_quantity - p_quantity` in the conditional UPDATE,
so each successful UPDATE sees the current committed value.

## Changes
- rpc_seller_end_auction: ORDER BY amount DESC, created_at ASC
- rpc_direct_buy: atomic decrement instead of pre-computed write
*/

-- ============================================================
-- Fix 1: Bid tie-breaking — earliest bid wins on tie
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_seller_end_auction(
  p_token text,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        uuid;
  v_product        products%ROWTYPE;
  v_winner_id      uuid := NULL;
  v_winning_amount numeric := NULL;
  v_bidder_ids     uuid[];
  v_tie_count      int := 0;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '找不到商品');
  END IF;
  IF v_product.seller_id != v_user_id THEN
    RETURN jsonb_build_object('error', '無權執行此操作');
  END IF;
  IF v_product.status != 'active' THEN
    RETURN jsonb_build_object('error', '商品已結標');
  END IF;

  -- Winner: highest amount, ties broken by earliest bid time
  SELECT bidder_id, amount INTO v_winner_id, v_winning_amount
  FROM bids
  WHERE product_id = p_product_id
  ORDER BY amount DESC, created_at ASC
  LIMIT 1;

  -- Check if there was a tie at the winning amount
  SELECT count(*) INTO v_tie_count
  FROM bids
  WHERE product_id = p_product_id AND amount = v_winning_amount;

  SELECT ARRAY_AGG(DISTINCT bidder_id) INTO v_bidder_ids
  FROM bids WHERE product_id = p_product_id;

  UPDATE products
  SET status = 'ended',
      winner_id = v_winner_id,
      winning_amount = v_winning_amount
  WHERE id = p_product_id;

  IF v_bidder_ids IS NOT NULL AND array_length(v_bidder_ids, 1) > 0 THEN
    INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
    SELECT
      b_id, p_product_id,
      CASE WHEN b_id = v_winner_id THEN 'won'::text ELSE 'lost'::text END,
      CASE WHEN b_id = v_winner_id THEN '恭喜您得標！' ELSE '競標結果通知' END,
      CASE WHEN b_id = v_winner_id
        THEN '您以 NT$ ' || v_winning_amount::TEXT || ' 成功得標「' || v_product.name || '」' ||
             CASE WHEN v_tie_count > 1 THEN '（同額以先出價者優先）' ELSE '' END ||
             '，請等候賣家聯繫交付事宜。'
        ELSE '很遺憾，您未能得標「' || v_product.name || '」，感謝您的參與。'
      END,
      false
    FROM UNNEST(v_bidder_ids) AS b_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'winner_id', v_winner_id,
    'winning_amount', v_winning_amount,
    'tie_count', v_tie_count
  );
END;
$function$;

-- ============================================================
-- Fix 2: Direct buy — atomic stock decrement (no oversell)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_direct_buy(
  p_token text,
  p_product_id uuid,
  p_quantity int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      uuid;
  v_product      products%ROWTYPE;
  v_total_amount bigint;
  v_delivery_id  uuid;
  v_rows_updated int;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '找不到此商品');
  END IF;

  IF v_product.is_direct_buy IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '此商品非直購商品');
  END IF;
  IF v_product.status != 'active' THEN
    RETURN jsonb_build_object('error', '此商品已售完');
  END IF;
  IF v_product.seller_id = v_user_id THEN
    RETURN jsonb_build_object('error', '不能購買自己的商品');
  END IF;
  IF p_quantity < 1 THEN
    RETURN jsonb_build_object('error', '購買數量必須至少為1');
  END IF;

  -- Check stock first for a clear error message
  IF COALESCE(v_product.stock_quantity, 0) < p_quantity THEN
    RETURN jsonb_build_object(
      'error', '庫存不足，剩餘 ' || COALESCE(v_product.stock_quantity, 0) || ' 件'
    );
  END IF;

  v_total_amount := COALESCE(v_product.direct_price, 0) * p_quantity;

  -- Atomic conditional decrement: only succeeds if stock is still sufficient.
  -- Using stock_quantity - p_quantity (not a pre-computed value) ensures
  -- concurrent transactions each see the latest committed stock.
  UPDATE products
  SET stock_quantity = stock_quantity - p_quantity,
      status = CASE WHEN stock_quantity - p_quantity <= 0 THEN 'ended' ELSE status END,
      winner_id = CASE WHEN stock_quantity - p_quantity <= 0 THEN v_user_id ELSE winner_id END,
      winning_amount = CASE WHEN stock_quantity - p_quantity <= 0 THEN v_total_amount ELSE winning_amount END
  WHERE id = p_product_id
    AND status = 'active'
    AND stock_quantity >= p_quantity;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Another buyer purchased between our read and write
    RETURN jsonb_build_object(
      'error', '購買失敗，商品可能已被其他人購買，請重新整理'
    );
  END IF;

  -- Create delivery record
  INSERT INTO deliveries (product_id, winner_id, seller_id, status, quantity, purchase_amount, is_direct_buy)
  VALUES (p_product_id, v_user_id, v_product.seller_id, 'pending', p_quantity, v_total_amount, true)
  RETURNING id INTO v_delivery_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
  VALUES (v_user_id, p_product_id, 'won', '直購成功！',
    '您已成功購買「' || v_product.name || '」× ' || p_quantity || ' 件，金額 NT$ ' || v_total_amount::TEXT || '，請等候賣家聯繫交付事宜。',
    false);

  -- Notify seller
  INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
  VALUES (v_product.seller_id, p_product_id, 'new_bid', '新訂單！請出貨',
    '買家已直購「' || v_product.name || '」× ' || p_quantity || ' 件，金額 NT$ ' || v_total_amount::TEXT || '，請盡快安排出貨。',
    false);

  RETURN jsonb_build_object('success', true, 'delivery_id', v_delivery_id, 'total_amount', v_total_amount);
END;
$function$;

-- Revoke direct execute
REVOKE EXECUTE ON FUNCTION public.rpc_seller_end_auction(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_direct_buy(text, uuid, int) FROM PUBLIC, anon, authenticated;
