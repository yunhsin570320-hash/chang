/*
  # 修補三個關鍵漏洞
  1. 新增 rpc_update_profile — 只允許更新安全欄位
  2. 移除 profiles 開放 INSERT/UPDATE 政策 — 只走 RPC
  3. 移除 rpc_create_session — 避免 UUID 偽冒 session
*/

-- ============================================================
-- 1. Profile 更新 RPC（只允許安全欄位）
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_update_profile(
  p_token              TEXT,
  p_phone              TEXT     DEFAULT NULL,
  p_payment_method     TEXT     DEFAULT NULL,
  p_bank_account       TEXT     DEFAULT NULL,
  p_shipping_address   TEXT     DEFAULT NULL,
  p_phone_verified     BOOLEAN  DEFAULT NULL,
  p_phone_verified_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

  IF p_phone IS NOT NULL AND p_phone != '' AND EXISTS(
    SELECT 1 FROM profiles WHERE phone = p_phone AND id != v_user_id
  ) THEN
    RETURN jsonb_build_object('error', '此手機號碼已被其他帳戶使用');
  END IF;

  UPDATE profiles SET
    phone              = NULLIF(TRIM(COALESCE(p_phone, '')), ''),
    payment_method     = NULLIF(TRIM(COALESCE(p_payment_method, '')), ''),
    bank_account       = NULLIF(TRIM(COALESCE(p_bank_account, '')), ''),
    shipping_address   = NULLIF(TRIM(COALESCE(p_shipping_address, '')), ''),
    phone_verified     = CASE WHEN p_phone_verified IS NOT NULL THEN p_phone_verified ELSE phone_verified END,
    phone_verified_at  = CASE WHEN p_phone_verified_at IS NOT NULL THEN p_phone_verified_at ELSE phone_verified_at END
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 2. 移除開放的 profiles INSERT/UPDATE 政策
-- ============================================================

DROP POLICY IF EXISTS "Anyone can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Anyone can update profiles"  ON profiles;

-- ============================================================
-- 3. 移除 rpc_create_session（UUID 偽冒風險）
-- ============================================================

DROP FUNCTION IF EXISTS rpc_create_session(UUID);
