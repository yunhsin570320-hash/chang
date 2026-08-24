/*
  # F6 — The payment amount is decided and verified by the server

  Before, `rpc_create_ecpay_order` stored the `p_amount` and `p_item_name` the browser
  supplied, the checkout endpoint signed a `totalAmount` taken from its own request
  body, and `rpc_confirm_ecpay_payment` marked the delivery paid without ever comparing
  what the gateway reported. A buyer could therefore pay NT$1 for any order.

  Now:
  - `rpc_create_ecpay_order` derives the amount and item name from the delivery and its
    product; the client-supplied values are ignored.
  - `rpc_get_ecpay_order_for_checkout` lets the checkout endpoint load the order for the
    authenticated buyer, so the form is built from stored values only.
  - `rpc_confirm_ecpay_payment` now takes the amount the gateway reported and refuses to
    settle the order unless it matches exactly.
*/

CREATE OR REPLACE FUNCTION public.rpc_create_ecpay_order(
  p_token text,
  p_delivery_id uuid,
  p_amount integer,
  p_item_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_delivery  deliveries%ROWTYPE;
  v_product   products%ROWTYPE;
  v_order     ecpay_orders%ROWTYPE;
  v_trade_no  text;
  v_amount    bigint;
  v_item_name text;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_delivery FROM deliveries WHERE id = p_delivery_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到交付記錄'); END IF;

  IF v_delivery.winner_id != v_user_id THEN
    RETURN jsonb_build_object('error', '只有買家可以發起付款');
  END IF;

  IF v_delivery.payment_status IS NOT NULL AND v_delivery.payment_status != 'unpaid' THEN
    RETURN jsonb_build_object('error', '此訂單付款狀態非待付款');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = v_delivery.product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到商品'); END IF;

  -- The amount is never taken from the caller.
  v_amount := CASE
    WHEN COALESCE(v_delivery.is_direct_buy, false) THEN COALESCE(v_delivery.purchase_amount, 0)
    ELSE COALESCE(v_product.winning_amount, 0)
  END;
  v_item_name := COALESCE(NULLIF(trim(v_product.name), ''), '競標平台商品');

  IF v_amount <= 0 OR v_amount > 2000000 THEN
    RETURN jsonb_build_object('error', '訂單金額不正確，無法線上付款');
  END IF;

  SELECT * INTO v_order FROM ecpay_orders
    WHERE delivery_id = p_delivery_id AND trade_status = 'pending'
    LIMIT 1;

  IF FOUND THEN
    -- Keep an existing pending order in step with the authoritative amount.
    IF v_order.total_amount != v_amount OR v_order.item_name IS DISTINCT FROM v_item_name THEN
      UPDATE ecpay_orders
      SET total_amount = v_amount, item_name = v_item_name, updated_at = now()
      WHERE id = v_order.id
      RETURNING * INTO v_order;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order.id,
      'merchant_trade_no', v_order.merchant_trade_no,
      'total_amount', v_order.total_amount,
      'item_name', v_order.item_name
    );
  END IF;

  v_trade_no := public.generate_merchant_trade_no();

  INSERT INTO ecpay_orders (delivery_id, merchant_trade_no, total_amount, item_name, trade_status)
  VALUES (p_delivery_id, v_trade_no, v_amount, v_item_name, 'pending')
  RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'merchant_trade_no', v_order.merchant_trade_no,
    'total_amount', v_order.total_amount,
    'item_name', v_order.item_name
  );
END;
$function$;

-- Checkout lookup: the edge function builds the gateway form from these values only.
CREATE OR REPLACE FUNCTION public.rpc_get_ecpay_order_for_checkout(
  p_token text,
  p_merchant_trade_no text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  UUID;
  v_order    ecpay_orders%ROWTYPE;
  v_delivery deliveries%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_order FROM ecpay_orders WHERE merchant_trade_no = p_merchant_trade_no;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到付款訂單'); END IF;

  SELECT * INTO v_delivery FROM deliveries WHERE id = v_order.delivery_id;
  IF NOT FOUND OR v_delivery.winner_id != v_user_id THEN
    RETURN jsonb_build_object('error', '找不到付款訂單');
  END IF;

  IF v_order.trade_status != 'pending' THEN
    RETURN jsonb_build_object('error', '此付款訂單已處理完成');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'merchant_trade_no', v_order.merchant_trade_no,
    'total_amount', v_order.total_amount,
    'item_name', v_order.item_name
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_ecpay_order_for_checkout(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_get_ecpay_order_for_checkout(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_get_ecpay_order_for_checkout(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_ecpay_order_for_checkout(text, text) TO service_role;

-- Confirmation now requires the reported amount to match the stored order.
CREATE OR REPLACE FUNCTION public.rpc_confirm_ecpay_payment(
  p_merchant_trade_no text,
  p_ecpay_trade_no text,
  p_payment_type text,
  p_trade_date text,
  p_check_mac_value text,
  p_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order ecpay_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM ecpay_orders WHERE merchant_trade_no = p_merchant_trade_no;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'order not found'); END IF;

  IF v_order.trade_status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  IF p_amount IS NULL OR p_amount != v_order.total_amount THEN
    UPDATE ecpay_orders
    SET trade_status = 'failed', updated_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('error', 'amount mismatch');
  END IF;

  UPDATE ecpay_orders SET
    trade_status = 'paid',
    ecpay_trade_no = p_ecpay_trade_no,
    payment_type = p_payment_type,
    trade_date = p_trade_date,
    ecpay_check_mac_value = p_check_mac_value,
    paid_at = now(),
    updated_at = now()
  WHERE id = v_order.id;

  UPDATE deliveries SET
    payment_status = 'paid',
    payment_method_chosen = COALESCE(p_payment_type, '綠界科技'),
    payment_marked_at = now(),
    updated_at = now()
  WHERE id = v_order.delivery_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_confirm_ecpay_payment(text, text, text, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_confirm_ecpay_payment(text, text, text, text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_confirm_ecpay_payment(text, text, text, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_ecpay_payment(text, text, text, text, text, integer) TO service_role;

-- Neutralise the old signature that settled orders without checking the amount.
CREATE OR REPLACE FUNCTION public.rpc_confirm_ecpay_payment(
  p_merchant_trade_no text,
  p_ecpay_trade_no text,
  p_payment_type text,
  p_trade_date text,
  p_check_mac_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('error', 'deprecated: amount verification required');
END;
$function$;
