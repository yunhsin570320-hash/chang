-- ============================================================
-- Payment tracking for auction wins and direct purchases
-- ============================================================
-- Adds payment status and tracking to the deliveries table.
-- Taiwan-standard flow: buyer pays via bank transfer or convenience
-- store code, then marks payment as made. Seller confirms receipt.

-- Add payment columns to deliveries
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_method_chosen text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz;

-- Add payment-related notification types
-- (notifications table already has a type column; just need to allow new values)
-- No schema change needed since type is text

-- RPC: Buyer marks payment as made
CREATE OR REPLACE FUNCTION public.rpc_buyer_mark_paid(
  p_token text,
  p_delivery_id uuid,
  p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    UUID;
  v_delivery   deliveries%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_delivery FROM deliveries WHERE id = p_delivery_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到此訂單'); END IF;
  IF v_delivery.winner_id != v_user_id THEN
    RETURN jsonb_build_object('error', '只有買家可以標記付款');
  END IF;
  IF v_delivery.payment_status = 'confirmed' THEN
    RETURN jsonb_build_object('error', '此訂單付款已確認');
  END IF;

  UPDATE deliveries
  SET payment_status = 'paid',
      payment_method_chosen = p_method,
      payment_reference = p_reference,
      payment_marked_at = now(),
      updated_at = now()
  WHERE id = p_delivery_id;

  -- Notify seller
  INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
  VALUES (v_delivery.seller_id, v_delivery.product_id, 'new_bid',
    '買家已標記付款',
    '買家已標記訂單付款，請確認款項是否收到。',
    false);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- RPC: Seller confirms payment received
CREATE OR REPLACE FUNCTION public.rpc_seller_confirm_payment(
  p_token text,
  p_delivery_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    UUID;
  v_delivery   deliveries%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_delivery FROM deliveries WHERE id = p_delivery_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到此訂單'); END IF;
  IF v_delivery.seller_id != v_user_id THEN
    RETURN jsonb_build_object('error', '只有賣家可以確認付款');
  END IF;
  IF v_delivery.payment_status != 'paid' THEN
    RETURN jsonb_build_object('error', '買家尚未標記付款');
  END IF;

  UPDATE deliveries
  SET payment_status = 'confirmed',
      payment_confirmed_at = now(),
      updated_at = now()
  WHERE id = p_delivery_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
  VALUES (v_delivery.winner_id, v_delivery.product_id, 'won',
    '賣家已確認付款',
    '賣家已確認收到您的付款，商品將開始安排出貨。',
    false);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Revoke direct access
REVOKE EXECUTE ON FUNCTION public.rpc_buyer_mark_paid(text, uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_seller_confirm_payment(text, uuid) FROM anon, authenticated;
