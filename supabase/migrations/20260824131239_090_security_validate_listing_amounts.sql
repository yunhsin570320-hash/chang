-- F9: the listing RPC accepted whatever prices, shipping fee and stock the client
-- sent, including negatives and a zero-priced direct-buy item. Validate them
-- server-side and back the rules with table constraints.

ALTER TABLE public.products
  ADD CONSTRAINT products_reserve_price_non_negative CHECK (reserve_price IS NULL OR reserve_price >= 0) NOT VALID;
ALTER TABLE public.products
  ADD CONSTRAINT products_direct_price_non_negative CHECK (direct_price IS NULL OR direct_price >= 0) NOT VALID;
ALTER TABLE public.products
  ADD CONSTRAINT products_shipping_fee_non_negative CHECK (shipping_fee IS NULL OR shipping_fee >= 0) NOT VALID;
ALTER TABLE public.products
  ADD CONSTRAINT products_stock_quantity_non_negative CHECK (stock_quantity IS NULL OR stock_quantity >= 0) NOT VALID;

CREATE OR REPLACE FUNCTION public.rpc_seller_create_product_v2(p_token text, p_name text, p_description text, p_image_url text, p_end_time timestamp with time zone, p_reserve_price numeric DEFAULT 0, p_is_direct_buy boolean DEFAULT false, p_direct_price numeric DEFAULT NULL::numeric, p_stock_quantity integer DEFAULT NULL::integer, p_shipping_fee numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_user_id  UUID;
v_profile  profiles%ROWTYPE;
v_count   INT;
v_is_direct boolean := COALESCE(p_is_direct_buy, false);
v_end_time timestamptz := p_end_time;
v_shipping numeric := COALESCE(p_shipping_fee, 0);
v_reserve numeric := COALESCE(p_reserve_price, 0);
v_stock int := COALESCE(p_stock_quantity, 1);
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

-- Input validation: never trust amounts or text lengths from the client.
IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
RETURN jsonb_build_object('error', '請填寫商品名稱');
END IF;
IF length(trim(p_name)) > 200 THEN
RETURN jsonb_build_object('error', '商品名稱過長（最多 200 字）');
END IF;
IF p_description IS NOT NULL AND length(p_description) > 5000 THEN
RETURN jsonb_build_object('error', '商品描述過長（最多 5000 字）');
END IF;
IF v_reserve < 0 OR v_shipping < 0 THEN
RETURN jsonb_build_object('error', '金額不可為負數');
END IF;
IF v_reserve > 100000000 OR v_shipping > 100000000 OR COALESCE(p_direct_price, 0) > 100000000 THEN
RETURN jsonb_build_object('error', '金額超出允許範圍');
END IF;
IF v_stock < 1 OR v_stock > 100000 THEN
RETURN jsonb_build_object('error', '庫存數量不正確');
END IF;
IF v_is_direct THEN
IF p_direct_price IS NULL OR p_direct_price <= 0 THEN
RETURN jsonb_build_object('error', '請填寫有效的直購價格');
END IF;
ELSE
IF v_end_time IS NULL OR v_end_time <= now() THEN
RETURN jsonb_build_object('error', '結標時間必須晚於現在');
END IF;
IF v_end_time > now() + interval '90 days' THEN
RETURN jsonb_build_object('error', '結標時間過遠（最多 90 天）');
END IF;
END IF;
IF v_end_time IS NULL THEN
RETURN jsonb_build_object('error', '缺少結標時間');
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
v_stock,
v_reserve, true, v_shipping
) RETURNING id INTO v_product_id;

RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$function$;