-- ============================================================
-- Membership Tier System
-- ============================================================
-- Free: can only use direct buy hall, max 5 product listings
-- VIP (NT$500 upgrade): unlimited product listings
-- VIP Buyer (NT$1000 deposit): can bid in auction hall
-- Violations (abandoned bids, fake products, dishonest listings) → locked
-- Locked users can file complaints; admin can unlock

-- Add membership columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS membership_tier text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS vip_upgrade_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vip_deposit_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vip_upgrade_at timestamptz,
  ADD COLUMN IF NOT EXISTS vip_deposit_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_reason text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_reason text;

-- Create complaints table for locked users to appeal
CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  admin_response text,
  resolved_by uuid REFERENCES profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "complaint_select_own" ON complaints FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "complaint_insert_own" ON complaints FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "complaint_update_admin" ON complaints FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
CREATE POLICY "complaint_delete_admin" ON complaints FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Add bid_abandon_count to profiles for tracking
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bid_abandon_count int DEFAULT 0;

-- Update is_blocked logic: lock_reason replaces/augments blocked_reason
-- is_blocked = true means locked (cannot bid, cannot list new products)

-- ============================================================
-- RPC: Upgrade to VIP Seller (pay NT$500)
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
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定，無法升級。請先申訴解鎖。');
  END IF;

  UPDATE profiles
  SET membership_tier = 'vip',
      vip_upgrade_paid = true,
      vip_upgrade_at = now()
  WHERE id = v_user_id;

  -- Notify user
  INSERT INTO notifications (user_id, type, title, message, is_read)
  VALUES (v_user_id, 'won', 'VIP 會員升級成功',
    '您已成功升級為 VIP 會員，商品上架數量無限制。', false);

  RETURN jsonb_build_object('success', true, 'membership_tier', 'vip');
END;
$function$;

-- ============================================================
-- RPC: Pay VIP deposit (NT$1000) to unlock auction bidding
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_pay_vip_deposit(
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
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定，無法繳交保證金。請先申訴解鎖。');
  END IF;

  UPDATE profiles
  SET vip_deposit_paid = true,
      vip_deposit_at = now()
  WHERE id = v_user_id;

  INSERT INTO notifications (user_id, type, title, message, is_read)
  VALUES (v_user_id, 'won', '競標保證金已繳納',
    '您已繳納競標保證金 NT$1000，現在可以在競價廳參與競標。', false);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- RPC: Create product with membership tier enforcement
-- Replaces rpc_seller_create_product — adds 5-product limit for free members
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

  -- Membership tier enforcement:
  -- Free members can only list direct-buy products, max 5 active
  -- VIP members can list unlimited (auction or direct)
  IF v_profile.membership_tier = 'free' OR v_profile.membership_tier IS NULL THEN
    -- Free members cannot create auction products
    IF NOT v_is_direct THEN
      RETURN jsonb_build_object('error', '免費會員僅可上架直購商品。升級 VIP 會員（NT$500）即可上架競標商品。');
    END IF;
    -- Check active listing count (max 5 for free)
    SELECT count(*) INTO v_count
    FROM products
    WHERE seller_id = v_user_id
      AND status = 'active';
    IF v_count >= 5 THEN
      RETURN jsonb_build_object('error', '免費會員最多上架 5 件商品。升級 VIP 會員即可無限制上架。');
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
-- RPC: Place bid with membership enforcement
-- Requires: VIP deposit paid, not blocked, not seller
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

  -- VIP deposit required for bidding
  IF NOT v_profile.vip_deposit_paid THEN
    RETURN jsonb_build_object('error', '參與競標需繳納保證金 NT$1000。請至會員中心升級。');
  END IF;

  -- Check if already bid (one bid per user per product)
  SELECT * INTO v_existing FROM bids WHERE product_id = p_product_id AND bidder_id = v_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object('error', '您已對此商品出價，每人僅能出價一次');
  END IF;

  -- Check reserve price
  IF v_product.reserve_price > 0 AND p_amount < v_product.reserve_price THEN
    RETURN jsonb_build_object('error', '出價金額必須不低於底價 NT$' || v_product.reserve_price::text);
  END IF;

  INSERT INTO bids (product_id, bidder_id, amount)
  VALUES (p_product_id, v_user_id, p_amount);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- RPC: Admin lock a user
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_lock_user(
  p_token text,
  p_target_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_admin    profiles%ROWTYPE;
  v_target   profiles%ROWTYPE;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_admin FROM profiles WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT * INTO v_target FROM profiles WHERE id = p_target_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;

  UPDATE profiles
  SET is_blocked = true,
      lock_reason = p_reason,
      locked_at = now(),
      blocked_reason = p_reason
  WHERE id = p_target_user_id;

  -- Log admin action
  INSERT INTO admin_actions (admin_id, target_user_id, action_type, reason)
  VALUES (v_admin_id, p_target_user_id, 'block', p_reason);

  -- Notify the locked user
  INSERT INTO notifications (user_id, type, title, message, is_read)
  VALUES (p_target_user_id, 'won', '帳號已鎖定',
    '您的帳號已因「' || p_reason || '」被鎖定。如認為有誤，請至會員中心提出申訴。', false);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- RPC: Admin unlock a user
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_unlock_user(
  p_token text,
  p_target_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_admin    profiles%ROWTYPE;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_admin FROM profiles WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  UPDATE profiles
  SET is_blocked = false,
      lock_reason = NULL,
      locked_at = NULL,
      blocked_reason = NULL,
      unlock_requested_at = NULL,
      unlock_reason = NULL,
      bid_abandon_count = 0
  WHERE id = p_target_user_id;

  INSERT INTO admin_actions (admin_id, target_user_id, action_type, reason)
  VALUES (v_admin_id, p_target_user_id, 'unblock', p_reason);

  INSERT INTO notifications (user_id, type, title, message, is_read)
  VALUES (p_target_user_id, 'won', '帳號已解鎖',
    '您的帳號已解鎖。' || p_reason, false);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- RPC: User files a complaint (unlock request)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_file_complaint(
  p_token text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_profile profiles%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF NOT v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '您的帳號未被鎖定，無需申訴');
  END IF;

  -- Check if already has a pending complaint
  IF EXISTS (SELECT 1 FROM complaints WHERE user_id = v_user_id AND status = 'pending') THEN
    RETURN jsonb_build_object('error', '您已有待處理的申訴，請等候管理員審核');
  END IF;

  INSERT INTO complaints (user_id, reason, status)
  VALUES (v_user_id, p_reason, 'pending');

  UPDATE profiles
  SET unlock_requested_at = now(),
      unlock_reason = p_reason
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- RPC: Admin resolve a complaint
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_complaint(
  p_token text,
  p_complaint_id uuid,
  p_approve boolean,
  p_response text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_admin    profiles%ROWTYPE;
  v_complaint complaints%ROWTYPE;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_admin FROM profiles WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT * INTO v_complaint FROM complaints WHERE id = p_complaint_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到申訴記錄'); END IF;

  UPDATE complaints
  SET status = CASE WHEN p_approve THEN 'resolved' ELSE 'dismissed' END,
      admin_response = p_response,
      resolved_by = v_admin_id,
      resolved_at = now()
  WHERE id = p_complaint_id;

  IF p_approve THEN
    -- Unlock the user
    UPDATE profiles
    SET is_blocked = false,
        lock_reason = NULL,
        locked_at = NULL,
        blocked_reason = NULL,
        unlock_requested_at = NULL,
        unlock_reason = NULL,
        bid_abandon_count = 0
    WHERE id = v_complaint.user_id;

    INSERT INTO notifications (user_id, type, title, message, is_read)
    VALUES (v_complaint.user_id, 'won', '申訴通過，帳號已解鎖',
      '您的申訴已通過審核，帳號已解鎖。' || COALESCE(p_response, ''), false);
  ELSE
    INSERT INTO notifications (user_id, type, title, message, is_read)
    VALUES (v_complaint.user_id, 'won', '申訴未通過',
      '您的申訴未通過審核。' || COALESCE(p_response, ''), false);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Revoke direct access on all new functions
REVOKE EXECUTE ON FUNCTION public.rpc_upgrade_vip_seller(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_pay_vip_deposit(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_seller_create_product_v2(text, text, text, text, timestamptz, numeric, boolean, numeric, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_place_bid_v2(text, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_lock_user(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_unlock_user(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_file_complaint(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_resolve_complaint(text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- Update existing admin account to VIP so they're not restricted
UPDATE profiles
SET membership_tier = 'vip',
    vip_upgrade_paid = true,
    vip_deposit_paid = true
WHERE is_admin = true;
