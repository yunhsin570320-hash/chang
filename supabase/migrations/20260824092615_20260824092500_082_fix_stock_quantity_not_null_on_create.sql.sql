-- Fix: stock_quantity is NOT NULL with default 1, but rpc_seller_create_product_v2
-- inserts NULL for auction products (is_direct_buy = false), causing a constraint violation.
-- Change the COALESCE to use 1 as fallback for auction products instead of NULL.

CREATE OR REPLACE FUNCTION public.rpc_seller_create_product_v2(
  p_token text,
  p_name text,
  p_description text,
  p_image_url text,
  p_end_time timestamp with time zone,
  p_reserve_price numeric DEFAULT 0,
  p_is_direct_buy boolean DEFAULT false,
  p_direct_price numeric DEFAULT NULL,
  p_stock_quantity integer DEFAULT NULL,
  p_shipping_fee numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_profile   profiles%ROWTYPE;
  v_count     INT;
  v_is_direct boolean := COALESCE(p_is_direct_buy, false);
  v_end_time  timestamptz := p_end_time;
  v_shipping  numeric := COALESCE(p_shipping_fee, 0);
  v_product_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF NOT v_profile.is_seller THEN
    RETURN jsonb_build_object('error', '您沒有賣家身份');
  END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定：' || COALESCE(v_profile.lock_reason, v_profile.blocked_reason, '違反平台規範'));
  END IF;

  -- Membership tier enforcement:
  -- Free members can only list direct-buy products, max 5 active
  -- VIP members can list unlimited (auction or direct)
  IF v_profile.membership_tier = 'free' OR v_profile.membership_tier IS NULL THEN
    IF NOT v_is_direct THEN
      RETURN jsonb_build_object('error', '免費會員僅可上架直購商品，請升級 VIP');
    END IF;
    SELECT count(*) INTO v_count FROM products WHERE seller_id = v_user_id AND status = 'active' AND is_direct_buy = true AND is_archived = false;
    IF v_count >= 5 THEN
      RETURN jsonb_build_object('error', '免費會員最多上架 5 件直購商品，請升級 VIP');
    END IF;
  END IF;

  INSERT INTO products (
    name, description, image_url, seller_id, end_time,
    status, is_direct_buy, direct_price, stock_quantity,
    reserve_price, is_approved, shipping_fee
  ) VALUES (
    trim(p_name), trim(p_description), p_image_url, v_user_id,
    v_end_time, 'active', v_is_direct, p_direct_price,
    COALESCE(p_stock_quantity, CASE WHEN v_is_direct THEN 1 ELSE 1 END),
    COALESCE(p_reserve_price, 0), true, v_shipping
  ) RETURNING id INTO v_product_id;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$function$;

-- Preserve permissions: only service_role can execute
REVOKE ALL ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamp with time zone, numeric, boolean, numeric, integer, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamp with time zone, numeric, boolean, numeric, integer, numeric
) TO service_role;
