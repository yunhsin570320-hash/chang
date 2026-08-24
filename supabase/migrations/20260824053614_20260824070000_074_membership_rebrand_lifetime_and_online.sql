-- ============================================================
-- Membership rebrand: platform maintenance fee + lifetime for first 1000
-- + online presence tracking
-- ============================================================

-- Add new columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS membership_number int,
  ADD COLUMN IF NOT EXISTS is_lifetime boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Sequence for membership numbers (assigned when platform maintenance fee is paid)
CREATE SEQUENCE IF NOT EXISTS membership_number_seq START 1;

-- Index for online count query
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at ON profiles(last_seen_at);

-- ============================================================
-- RPC: Heartbeat — update last_seen_at for online tracking
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_heartbeat(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  UPDATE profiles SET last_seen_at = now() WHERE id = v_user_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- RPC: Get member stats (public — no token needed)
-- Returns total users, online count, paid members, lifetime members
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_member_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_users int;
  v_online_count int;
  v_paid_members int;
  v_lifetime_members int;
BEGIN
  SELECT count(*) INTO v_total_users FROM profiles;
  SELECT count(*) INTO v_online_count FROM profiles WHERE last_seen_at > now() - interval '5 minutes';
  SELECT count(*) INTO v_paid_members FROM profiles WHERE membership_tier = 'vip';
  SELECT count(*) INTO v_lifetime_members FROM profiles WHERE is_lifetime = true;

  RETURN jsonb_build_object(
    'success', true,
    'total_users', v_total_users,
    'online_count', v_online_count,
    'paid_members', v_paid_members,
    'lifetime_members', v_lifetime_members
  );
END;
$function$;

-- ============================================================
-- Updated: rpc_admin_review_payment_request
-- Now assigns membership_number and is_lifetime on vip_upgrade approval
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_review_payment_request(
  p_token text,
  p_request_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id   UUID;
  v_admin      profiles%ROWTYPE;
  v_request    payment_requests%ROWTYPE;
  v_mem_num    INT;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_admin FROM profiles WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT * INTO v_request FROM payment_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到此繳費申請'); END IF;
  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', '此申請已審核過了');
  END IF;

  UPDATE payment_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      admin_note = p_note,
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  IF p_approve THEN
    IF v_request.type = 'vip_upgrade' THEN
      SELECT membership_number INTO v_mem_num FROM profiles WHERE id = v_request.user_id;
      IF v_mem_num IS NULL THEN
        v_mem_num := nextval('membership_number_seq');
      END IF;

      UPDATE profiles
      SET membership_tier = 'vip',
          vip_upgrade_paid = true,
          vip_upgrade_at = now(),
          membership_number = v_mem_num,
          is_lifetime = (v_mem_num <= 1000)
      WHERE id = v_request.user_id;

      INSERT INTO notifications (user_id, type, title, message, is_read)
      VALUES (v_request.user_id, 'won', '平台維護費繳納成功',
        CASE
          WHEN v_mem_num <= 1000 THEN
            '管理員已確認您的付款，您已升級為付費會員（終身制，會員編號 #' || v_mem_num || '），商品上架無限制。'
          ELSE
            '管理員已確認您的付款，您已升級為付費會員（會員編號 #' || v_mem_num || '），商品上架無限制。'
        END, false);
    ELSIF v_request.type = 'vip_deposit' THEN
      UPDATE profiles
      SET vip_deposit_paid = true,
          vip_deposit_at = now()
      WHERE id = v_request.user_id;

      INSERT INTO notifications (user_id, type, title, message, is_read)
      VALUES (v_request.user_id, 'won', '競標保證金已繳納',
        '管理員已確認您的付款，您現在可以在競價廳參與競標。', false);
    END IF;
  ELSE
    INSERT INTO notifications (user_id, type, title, message, is_read)
    VALUES (v_request.user_id, 'won', '繳費申請未通過',
      '您的繳費證明未通過審核。' || COALESCE(p_note, ''), false);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- Updated: rpc_upgrade_vip_seller — assign membership_number + is_lifetime
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_upgrade_vip_seller(
  p_token text,
  p_payment_method text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_profile profiles%ROWTYPE;
  v_mem_num INT;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定，無法升級。請先申訴解鎖。');
  END IF;

  SELECT membership_number INTO v_mem_num FROM profiles WHERE id = v_user_id;
  IF v_mem_num IS NULL THEN
    v_mem_num := nextval('membership_number_seq');
  END IF;

  UPDATE profiles
  SET membership_tier = 'vip',
      vip_upgrade_paid = true,
      vip_upgrade_at = now(),
      membership_number = v_mem_num,
      is_lifetime = (v_mem_num <= 1000)
  WHERE id = v_user_id;

  INSERT INTO notifications (user_id, type, title, message, is_read)
  VALUES (v_user_id, 'won', '平台維護費繳納成功',
    CASE
      WHEN v_mem_num <= 1000 THEN
        '您已成功繳納平台維護費，升級為付費會員（終身制，會員編號 #' || v_mem_num || '），商品上架數量無限制。'
      ELSE
        '您已成功繳納平台維護費，升級為付費會員（會員編號 #' || v_mem_num || '），商品上架數量無限制。'
    END, false);

  RETURN jsonb_build_object('success', true, 'membership_tier', 'vip', 'membership_number', v_mem_num, 'is_lifetime', v_mem_num <= 1000);
END;
$function$;

-- ============================================================
-- Updated: rpc_submit_payment_request — renamed fee labels
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_submit_payment_request(
  p_token text,
  p_type text,
  p_payment_method text DEFAULT NULL,
  p_proof_image_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_profile   profiles%ROWTYPE;
  v_amount    NUMERIC;
  v_existing  payment_requests%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定，無法申請繳費。請先申訴解鎖。');
  END IF;

  IF p_type = 'vip_upgrade' THEN
    v_amount := 500;
    IF v_profile.membership_tier = 'vip' THEN
      RETURN jsonb_build_object('error', '您已是付費會員');
    END IF;
  ELSIF p_type = 'vip_deposit' THEN
    v_amount := 1000;
    IF v_profile.vip_deposit_paid THEN
      RETURN jsonb_build_object('error', '您已繳納競標保證金');
    END IF;
  ELSE
    RETURN jsonb_build_object('error', '無效的繳費類型');
  END IF;

  SELECT * INTO v_existing
  FROM payment_requests
  WHERE user_id = v_user_id AND type = p_type AND status = 'pending'
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('error', '您已有待審核的同類型繳費申請，請等候管理員審核');
  END IF;

  IF p_proof_image_url IS NULL OR trim(p_proof_image_url) = '' THEN
    RETURN jsonb_build_object('error', '請上傳付款證明截圖');
  END IF;

  INSERT INTO payment_requests (user_id, type, amount, payment_method, proof_image_url, status)
  VALUES (v_user_id, p_type, v_amount, p_payment_method, p_proof_image_url, 'pending');

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- Updated: rpc_seller_create_product_v2 — renamed fee labels in errors
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_seller_create_product_v2(
  p_token text,
  p_name text,
  p_description text,
  p_image_url text,
  p_end_time timestamptz,
  p_reserve_price numeric DEFAULT 0,
  p_is_direct_buy boolean DEFAULT false,
  p_direct_price numeric DEFAULT NULL,
  p_stock_quantity int DEFAULT NULL
)
RETURNS jsonb
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

  IF v_profile.membership_tier = 'free' OR v_profile.membership_tier IS NULL THEN
    IF NOT v_is_direct THEN
      RETURN jsonb_build_object('error', '免費會員僅可上架直購商品。繳交平台維護費（NT$500）即可上架競標商品。');
    END IF;
    SELECT count(*) INTO v_count
    FROM products
    WHERE seller_id = v_user_id
      AND status = 'active';
    IF v_count >= 5 THEN
      RETURN jsonb_build_object('error', '免費會員最多上架 5 件商品。繳交平台維護費即可無限制上架。');
    END IF;
  END IF;

  INSERT INTO products (
    name, description, image_url, seller_id, end_time,
    status, is_direct_buy, direct_price, stock_quantity,
    reserve_price, is_approved
  ) VALUES (
    trim(p_name), trim(p_description), p_image_url, v_user_id,
    v_end_time, 'active', v_is_direct, p_direct_price,
    COALESCE(p_stock_quantity, CASE WHEN v_is_direct THEN 1 ELSE NULL END),
    COALESCE(p_reserve_price, 0), true
  ) RETURNING id INTO v_user_id;

  RETURN jsonb_build_object('success', true, 'product_id', v_user_id);
END;
$function$;

-- ============================================================
-- Updated: rpc_place_bid_v2 — renamed fee labels in errors
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_place_bid_v2(
  p_token text,
  p_product_id uuid,
  p_amount int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_profile   profiles%ROWTYPE;
  v_product   products%ROWTYPE;
  v_existing  bids%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定：' || COALESCE(v_profile.lock_reason, v_profile.blocked_reason, '違反平台規範'));
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到商品'); END IF;
  IF v_product.status != 'active' THEN
    RETURN jsonb_build_object('error', '此商品已結標');
  END IF;
  IF v_product.is_direct_buy THEN
    RETURN jsonb_build_object('error', '直購商品無法競標');
  END IF;
  IF v_product.seller_id = v_user_id THEN
    RETURN jsonb_build_object('error', '賣家不得對自己的商品出價');
  END IF;

  IF NOT v_profile.vip_deposit_paid THEN
    RETURN jsonb_build_object('error', '參與競標需繳納保證金 NT$1000。請至會員中心繳費。');
  END IF;

  SELECT * INTO v_existing FROM bids WHERE product_id = p_product_id AND bidder_id = v_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object('error', '您已對此商品出價，每人僅能出價一次');
  END IF;

  IF v_product.reserve_price > 0 AND p_amount < v_product.reserve_price THEN
    RETURN jsonb_build_object('error', '出價金額必須不低於底價 NT$' || v_product.reserve_price::text);
  END IF;

  INSERT INTO bids (product_id, bidder_id, amount)
  VALUES (p_product_id, v_user_id, p_amount);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Revoke execute on new functions
REVOKE EXECUTE ON FUNCTION public.rpc_heartbeat(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_get_member_stats() FROM PUBLIC, anon, authenticated;