/*
# ECPay RPCs — Create Order & Confirm Payment

## Overview
Adds two SECURITY DEFINER functions:
1. `rpc_create_ecpay_order` — buyer initiates an ECPay payment for a delivery
2. `rpc_confirm_ecpay_payment` — called by edge function callback to mark payment as paid

## rpc_create_ecpay_order
- Verifies the buyer owns the delivery
- Checks the delivery payment_status is 'unpaid'
- Creates an ecpay_orders row with 'pending' status
- Returns the order details (merchant_trade_no, total_amount, item_name)

## rpc_confirm_ecpay_payment
- Called by the ECPay callback edge function (using service role internally)
- Looks up the order by merchant_trade_no
- Updates trade_status to 'paid', stores ECPay trade info
- Also updates the linked delivery's payment_status to 'paid'
- Idempotent — safe to call multiple times (ECPay may retry callbacks)

## Security
- Both functions are SECURITY DEFINER with search_path = 'public'
- rpc_create_ecpay_order: revoked from anon, granted to authenticated
- rpc_confirm_ecpay_payment: revoked from anon AND authenticated — only callable
  via service role key from the edge function callback
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
  v_user_id     UUID;
  v_delivery    deliveries%ROWTYPE;
  v_order       ecpay_orders%ROWTYPE;
  v_trade_no    text;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_delivery FROM deliveries WHERE id = p_delivery_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到交付記錄'); END IF;

  -- Only the buyer (winner) can initiate payment
  IF v_delivery.winner_id != v_user_id THEN
    RETURN jsonb_build_object('error', '只有買家可以发起付款');
  END IF;

  -- Check payment status is unpaid
  IF v_delivery.payment_status IS NOT NULL AND v_delivery.payment_status != 'unpaid' THEN
    RETURN jsonb_build_object('error', '此訂單付款狀態非待付款');
  END IF;

  -- Check for existing pending order
  SELECT * INTO v_order FROM ecpay_orders
    WHERE delivery_id = p_delivery_id AND trade_status = 'pending'
    LIMIT 1;

  IF FOUND THEN
    -- Reuse existing pending order
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
  VALUES (p_delivery_id, v_trade_no, p_amount, p_item_name, 'pending')
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

REVOKE EXECUTE ON FUNCTION public.rpc_create_ecpay_order(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_ecpay_order(text, uuid, integer, text) TO authenticated;

-- Confirm payment from ECPay callback (service-role only)
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
DECLARE
  v_order ecpay_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM ecpay_orders WHERE merchant_trade_no = p_merchant_trade_no;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'order not found'); END IF;

  -- Idempotent: if already paid, just return success
  IF v_order.trade_status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  -- Update the ecpay_orders row
  UPDATE ecpay_orders SET
    trade_status = 'paid',
    ecpay_trade_no = p_ecpay_trade_no,
    payment_type = p_payment_type,
    trade_date = p_trade_date,
    ecpay_check_mac_value = p_check_mac_value,
    paid_at = now(),
    updated_at = now()
  WHERE id = v_order.id;

  -- Update the linked delivery's payment_status
  UPDATE deliveries SET
    payment_status = 'paid',
    payment_method_chosen = COALESCE(p_payment_type, '綠界科技'),
    payment_marked_at = now()
  WHERE id = v_order.delivery_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_confirm_ecpay_payment(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
