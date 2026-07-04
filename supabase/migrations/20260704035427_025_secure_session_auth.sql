/*
  # 安全強化：Session Token 系統 + 安全 RPC
*/

-- ============================================================
-- 1. Session 表
-- ============================================================
CREATE TABLE IF NOT EXISTS app_sessions (
  token     TEXT         NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  user_id   UUID         NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  CONSTRAINT app_sessions_pkey PRIMARY KEY (token),
  CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id   ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at);

ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
-- No policies = only SECURITY DEFINER functions (running as postgres) can access

-- ============================================================
-- 2. Helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION app_get_user_id(p_token TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM app_sessions
  WHERE token = p_token AND expires_at > now()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_is_admin(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = p_user_id LIMIT 1), false)
$$;

-- ============================================================
-- 3. Auth RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_login(
  p_email            TEXT,
  p_password_hash    TEXT,
  p_password_original TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p     profiles%ROWTYPE;
  v_token TEXT;
  v_match BOOLEAN := false;
BEGIN
  SELECT * INTO v_p FROM profiles WHERE email = lower(trim(p_email)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '郵箱或密碼錯誤'); END IF;
  IF v_p.is_blocked THEN
    RETURN jsonb_build_object('error', '此帳號已被停用。原因：' || COALESCE(v_p.blocked_reason, '違反使用規範'));
  END IF;

  IF v_p.password_hash IS NOT NULL AND length(v_p.password_hash) = 64 AND v_p.password_hash ~ '^[0-9a-f]+$' THEN
    v_match := (v_p.password_hash = p_password_hash);
  ELSE
    v_match := (v_p.password_hash = p_password_original);
    IF v_match AND p_password_hash IS NOT NULL AND length(p_password_hash) = 64 THEN
      UPDATE profiles SET password_hash = p_password_hash WHERE id = v_p.id;
    END IF;
  END IF;

  IF NOT v_match THEN RETURN jsonb_build_object('error', '郵箱或密碼錯誤'); END IF;

  DELETE FROM app_sessions WHERE user_id = v_p.id AND expires_at < now();
  INSERT INTO app_sessions (user_id) VALUES (v_p.id) RETURNING token INTO v_token;

  RETURN jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_p.id, 'name', v_p.name, 'email', v_p.email, 'role', v_p.role,
      'is_buyer', v_p.is_buyer, 'is_seller', v_p.is_seller, 'is_admin', v_p.is_admin,
      'is_blocked', v_p.is_blocked, 'blocked_reason', v_p.blocked_reason,
      'blocked_at', v_p.blocked_at, 'warning_count', v_p.warning_count,
      'phone', v_p.phone, 'phone_verified', v_p.phone_verified,
      'phone_verified_at', v_p.phone_verified_at, 'payment_method', v_p.payment_method,
      'bank_account', v_p.bank_account, 'shipping_address', v_p.shipping_address,
      'created_at', v_p.created_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_register(
  p_name             TEXT,
  p_email            TEXT,
  p_password_hash    TEXT,
  p_is_buyer         BOOLEAN,
  p_is_seller        BOOLEAN,
  p_phone            TEXT DEFAULT NULL,
  p_shipping_address TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_token   TEXT;
  v_user    JSONB;
BEGIN
  IF EXISTS(SELECT 1 FROM profiles WHERE email = lower(trim(p_email))) THEN
    RETURN jsonb_build_object('error', '此郵箱已被註冊');
  END IF;
  IF p_phone IS NOT NULL AND p_phone != '' AND EXISTS(SELECT 1 FROM profiles WHERE phone = p_phone) THEN
    RETURN jsonb_build_object('error', '此手機號碼已被其他帳戶使用');
  END IF;

  INSERT INTO profiles (
    name, email, password_hash, is_buyer, is_seller,
    role, phone, phone_verified, phone_verified_at, shipping_address
  ) VALUES (
    trim(p_name), lower(trim(p_email)), p_password_hash,
    p_is_buyer, p_is_seller,
    CASE WHEN p_is_seller THEN 'seller' ELSE 'buyer' END,
    NULLIF(trim(p_phone), ''),
    (p_phone IS NOT NULL AND trim(p_phone) != ''),
    CASE WHEN p_phone IS NOT NULL AND trim(p_phone) != '' THEN now() ELSE NULL END,
    NULLIF(trim(p_shipping_address), '')
  )
  RETURNING id INTO v_user_id;

  INSERT INTO app_sessions (user_id) VALUES (v_user_id) RETURNING token INTO v_token;

  SELECT jsonb_build_object(
    'id', id, 'name', name, 'email', email, 'role', role,
    'is_buyer', is_buyer, 'is_seller', is_seller, 'is_admin', is_admin,
    'is_blocked', is_blocked, 'warning_count', warning_count,
    'phone', phone, 'phone_verified', phone_verified,
    'phone_verified_at', phone_verified_at, 'payment_method', payment_method,
    'bank_account', bank_account, 'shipping_address', shipping_address,
    'created_at', created_at
  ) INTO v_user FROM profiles WHERE id = v_user_id;

  RETURN jsonb_build_object('token', v_token, 'user', v_user);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_validate_session(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', id, 'name', name, 'email', email, 'role', role,
      'is_buyer', is_buyer, 'is_seller', is_seller, 'is_admin', is_admin,
      'is_blocked', is_blocked, 'blocked_reason', blocked_reason,
      'blocked_at', blocked_at, 'warning_count', warning_count,
      'phone', phone, 'phone_verified', phone_verified,
      'phone_verified_at', phone_verified_at, 'payment_method', payment_method,
      'bank_account', bank_account, 'shipping_address', shipping_address,
      'created_at', created_at
    ) FROM profiles WHERE id = v_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_create_session(p_user_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id = p_user_id AND (is_blocked IS NULL OR is_blocked = false)) THEN
    RETURN NULL;
  END IF;
  DELETE FROM app_sessions WHERE user_id = p_user_id AND expires_at < now();
  INSERT INTO app_sessions (user_id) VALUES (p_user_id) RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_logout(p_token TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM app_sessions WHERE token = p_token
$$;

-- ============================================================
-- 4. Seller RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_seller_create_product(
  p_token          TEXT,
  p_name           TEXT,
  p_description    TEXT,
  p_image_url      TEXT,
  p_end_time       TIMESTAMPTZ,
  p_reserve_price  INTEGER DEFAULT 0,
  p_is_direct_buy  BOOLEAN DEFAULT false,
  p_direct_price   INTEGER DEFAULT NULL,
  p_stock_quantity INTEGER DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_product_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id = v_user_id AND is_seller = true AND (is_blocked IS NULL OR is_blocked = false)) THEN
    RETURN jsonb_build_object('error', 'Not authorized');
  END IF;

  INSERT INTO products (
    name, description, seller_id, end_time, image_url, status, is_approved,
    is_direct_buy, reserve_price, direct_price, stock_quantity
  ) VALUES (
    trim(p_name), trim(p_description), v_user_id, p_end_time, p_image_url,
    'active', true, p_is_direct_buy,
    COALESCE(p_reserve_price, 0), p_direct_price, p_stock_quantity
  )
  RETURNING id INTO v_product_id;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_seller_end_auction(p_token TEXT, p_product_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_product        products%ROWTYPE;
  v_winner_id      UUID := NULL;
  v_winning_amount NUMERIC := NULL;
  v_bidder_ids     UUID[];
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Product not found'); END IF;
  IF v_product.seller_id != v_user_id THEN RETURN jsonb_build_object('error', 'Not authorized'); END IF;

  SELECT bidder_id, amount INTO v_winner_id, v_winning_amount
  FROM bids WHERE product_id = p_product_id ORDER BY amount DESC LIMIT 1;

  SELECT ARRAY_AGG(DISTINCT bidder_id) INTO v_bidder_ids FROM bids WHERE product_id = p_product_id;

  UPDATE products SET status = 'ended', winner_id = v_winner_id, winning_amount = v_winning_amount
  WHERE id = p_product_id;

  IF v_bidder_ids IS NOT NULL AND array_length(v_bidder_ids, 1) > 0 THEN
    INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
    SELECT
      b_id, p_product_id,
      CASE WHEN b_id = v_winner_id THEN 'won'::text ELSE 'lost'::text END,
      CASE WHEN b_id = v_winner_id THEN '恭喜您得標！' ELSE '競標結果通知' END,
      CASE WHEN b_id = v_winner_id
        THEN '您以 NT$ ' || v_winning_amount::TEXT || ' 成功得標「' || v_product.name || '」，請等候賣家聯繫交付事宜。'
        ELSE '很遺憾，您未能得標「' || v_product.name || '」，感謝您的參與。'
      END,
      false
    FROM UNNEST(v_bidder_ids) AS b_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'winner_id', v_winner_id, 'winning_amount', v_winning_amount);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_seller_relist_product(p_token TEXT, p_product_id UUID, p_end_time TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_seller_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;
  SELECT seller_id INTO v_seller_id FROM products WHERE id = p_product_id;
  IF NOT FOUND OR v_seller_id != v_user_id THEN RETURN jsonb_build_object('error', 'Not authorized'); END IF;
  UPDATE products SET status = 'active', end_time = p_end_time, winner_id = NULL, winning_amount = NULL
  WHERE id = p_product_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_seller_delete_product(p_token TEXT, p_product_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_seller_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;
  SELECT seller_id INTO v_seller_id FROM products WHERE id = p_product_id;
  IF NOT FOUND OR v_seller_id != v_user_id THEN RETURN jsonb_build_object('error', 'Not authorized'); END IF;
  DELETE FROM products WHERE id = p_product_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_seller_archive_products(p_token TEXT, p_product_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;
  UPDATE products SET is_archived = true
  WHERE id = ANY(p_product_ids) AND seller_id = v_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_seller_create_delivery(
  p_token           TEXT,
  p_product_id      UUID,
  p_winner_id       UUID,
  p_purchase_amount BIGINT,
  p_is_direct_buy   BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id    UUID;
  v_seller_id  UUID;
  v_delivery_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;
  SELECT seller_id INTO v_seller_id FROM products WHERE id = p_product_id;
  IF NOT FOUND OR v_seller_id != v_user_id THEN RETURN jsonb_build_object('error', 'Not authorized'); END IF;

  INSERT INTO deliveries (product_id, winner_id, seller_id, status, is_direct_buy, purchase_amount)
  VALUES (p_product_id, p_winner_id, v_user_id, 'pending', p_is_direct_buy, p_purchase_amount)
  RETURNING id INTO v_delivery_id;

  RETURN jsonb_build_object('success', true, 'delivery_id', v_delivery_id);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_seller_update_delivery(
  p_token             TEXT,
  p_delivery_id       UUID,
  p_status            TEXT,
  p_tracking_number   TEXT DEFAULT NULL,
  p_notes             TEXT DEFAULT NULL,
  p_completed_summary TEXT DEFAULT NULL,
  p_completed_at      TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id  UUID;
  v_delivery deliveries%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

  SELECT * INTO v_delivery FROM deliveries WHERE id = p_delivery_id;
  IF NOT FOUND OR v_delivery.seller_id != v_user_id THEN
    RETURN jsonb_build_object('error', 'Not authorized');
  END IF;

  UPDATE deliveries SET
    status            = p_status,
    updated_at        = now(),
    tracking_number   = COALESCE(p_tracking_number, tracking_number),
    notes             = COALESCE(p_notes, notes),
    completed_summary = COALESCE(p_completed_summary, completed_summary),
    completed_at      = COALESCE(p_completed_at, completed_at)
  WHERE id = p_delivery_id;

  IF p_status = 'completed' THEN
    IF NOT v_delivery.is_direct_buy THEN
      UPDATE products SET is_archived = true WHERE id = v_delivery.product_id;
    END IF;
    INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
    VALUES (
      v_delivery.winner_id, v_delivery.product_id, 'auction_ended', '交付完成',
      '「' || (SELECT name FROM products WHERE id = v_delivery.product_id) || '」已完成交付，感謝您的購買！',
      false
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 5. Admin RPC
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_admin_action(
  p_token       TEXT,
  p_action_type TEXT,
  p_target_type TEXT,
  p_target_id   UUID,
  p_reason      TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_target_user_id UUID := NULL;
  v_product_id     UUID := NULL;
  v_report         reports%ROWTYPE;
  v_warn_count     INTEGER;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;
  IF NOT app_is_admin(v_user_id) THEN RETURN jsonb_build_object('error', 'Not authorized'); END IF;

  IF p_target_type = 'user' THEN
    v_target_user_id := p_target_id;
  ELSIF p_target_type = 'product' THEN
    v_product_id := p_target_id;
  ELSIF p_target_type = 'report' THEN
    SELECT * INTO v_report FROM reports WHERE id = p_target_id;
    v_target_user_id := v_report.reported_user_id;
  END IF;

  IF p_action_type = 'warn' THEN
    SELECT COALESCE(warning_count, 0) + 1 INTO v_warn_count FROM profiles WHERE id = p_target_id;
    UPDATE profiles SET warning_count = v_warn_count WHERE id = p_target_id;
    INSERT INTO notifications (user_id, type, title, message, is_read)
    VALUES (p_target_id, 'auction_ended', '帳號警告通知',
            '您的帳號已收到管理員警告。原因：' || p_reason, false);

  ELSIF p_action_type = 'block' THEN
    UPDATE profiles SET is_blocked = true, blocked_reason = p_reason, blocked_at = now()
    WHERE id = p_target_id;
    UPDATE products SET status = 'ended' WHERE seller_id = p_target_id AND status = 'active';

  ELSIF p_action_type = 'unblock' THEN
    UPDATE profiles SET is_blocked = false, blocked_reason = NULL, blocked_at = NULL
    WHERE id = p_target_id;

  ELSIF p_action_type = 'remove_product' THEN
    UPDATE products SET status = 'ended', is_flagged = true, flag_reason = p_reason, is_approved = false
    WHERE id = p_target_id;

  ELSIF p_action_type = 'approve_product' THEN
    UPDATE products SET is_flagged = false, flag_reason = NULL, is_approved = true
    WHERE id = p_target_id;

  ELSIF p_action_type IN ('resolve_report', 'dismiss_report') THEN
    IF v_report.id IS NULL THEN SELECT * INTO v_report FROM reports WHERE id = p_target_id; END IF;
    UPDATE reports SET
      status      = CASE WHEN p_action_type = 'resolve_report' THEN 'resolved' ELSE 'dismissed' END,
      resolved_by = v_user_id,
      resolved_at = now(),
      admin_note  = p_reason
    WHERE id = p_target_id;
    IF v_report.reporter_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
      VALUES (
        v_report.reporter_id, v_report.product_id, 'auction_ended',
        CASE WHEN p_action_type = 'resolve_report' THEN '您的檢舉已受理' ELSE '您的檢舉已審閱' END,
        CASE WHEN p_action_type = 'resolve_report'
          THEN '您的檢舉已由管理員受理並採取行動。管理員備註：' || p_reason
          ELSE '您的檢舉經審閱後暫不採取行動。管理員備註：' || p_reason
        END,
        false
      );
    END IF;
  ELSE
    RETURN jsonb_build_object('error', 'Unknown action type');
  END IF;

  INSERT INTO admin_actions (admin_id, target_user_id, product_id, action_type, reason)
  VALUES (v_user_id, v_target_user_id, v_product_id, p_action_type, p_reason);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 6. Tighten RLS
-- ============================================================

-- products: remove all open mutation policies
DROP POLICY IF EXISTS "Anyone can insert products"               ON products;
DROP POLICY IF EXISTS "Anyone can update products"               ON products;
DROP POLICY IF EXISTS "Anyone can delete products"               ON products;
DROP POLICY IF EXISTS "Sellers can create own products"          ON products;
DROP POLICY IF EXISTS "Sellers can update own products"          ON products;
DROP POLICY IF EXISTS "Admins can update any product"            ON products;
DROP POLICY IF EXISTS "Sellers can delete own products"          ON products;
DROP POLICY IF EXISTS "Admins can delete any product"            ON products;

-- deliveries: remove all open mutation policies
DROP POLICY IF EXISTS "Anyone can insert deliveries"                       ON deliveries;
DROP POLICY IF EXISTS "Anyone can update deliveries"                       ON deliveries;
DROP POLICY IF EXISTS "Sellers can create deliveries for own products"     ON deliveries;
DROP POLICY IF EXISTS "Sellers and winners can update own deliveries"      ON deliveries;

-- admin_actions: remove open insert
DROP POLICY IF EXISTS "Anyone can insert admin actions"  ON admin_actions;
DROP POLICY IF EXISTS "Admins can insert admin actions"  ON admin_actions;

-- notifications: remove open insert (keep open update for mark-as-read)
DROP POLICY IF EXISTS "Anyone can insert notifications"                      ON notifications;
DROP POLICY IF EXISTS "Authenticated can insert notifications for any user"  ON notifications;
DROP POLICY IF EXISTS "Users can update own notification read status"        ON notifications;

-- reports: remove open update (filing new reports stays open)
DROP POLICY IF EXISTS "Anyone can update reports"  ON reports;
DROP POLICY IF EXISTS "Admins can update reports"  ON reports;

-- profiles: normalise to simple open policies (profile settings need UPDATE)
DROP POLICY IF EXISTS "Users can register own profile"  ON profiles;
DROP POLICY IF EXISTS "Users can update own profile"    ON profiles;
DROP POLICY IF EXISTS "Admins can update any profile"   ON profiles;
DROP POLICY IF EXISTS "Anyone can insert profiles"      ON profiles;
DROP POLICY IF EXISTS "Anyone can update profiles"      ON profiles;

CREATE POLICY "Anyone can insert profiles"
  ON profiles FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update profiles"
  ON profiles FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
