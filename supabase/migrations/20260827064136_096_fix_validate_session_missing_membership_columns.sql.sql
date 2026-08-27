/*
# Fix: rpc_validate_session and rpc_login missing membership columns

## Problem
Both `rpc_validate_session` and `rpc_login` build the user profile JSON with an
explicit column list that was written before the membership system (migration 046)
added `vip_deposit_paid`, `membership_tier`, `membership_number`, `is_lifetime`,
`vip_upgrade_paid`, `vip_deposit_at`, `vip_upgrade_at`, and `lock_reason`.

As a result, even after an admin approves a bid deposit (setting
`vip_deposit_paid = true` in the database), the app never receives that field —
it's always `undefined`/falsy, so `rpc_place_bid_v2` correctly allows the bid
server-side, but the client-side check `if (!user.vip_deposit_paid)` blocks the
user from even seeing the bid form.

## Fix
Add the missing columns to both `jsonb_build_object` calls.
No data changes, no new tables.
*/

-- ============================================================
-- Fix rpc_validate_session: add membership columns
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_validate_session(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_user_id uuid;
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
      'created_at', created_at,
      'membership_tier', membership_tier,
      'membership_number', membership_number,
      'is_lifetime', is_lifetime,
      'vip_upgrade_paid', vip_upgrade_paid,
      'vip_upgrade_at', vip_upgrade_at,
      'vip_deposit_paid', vip_deposit_paid,
      'vip_deposit_at', vip_deposit_at,
      'lock_reason', lock_reason
    ) FROM profiles WHERE id = v_user_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_validate_session(text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Fix rpc_login: add membership columns to returned user object
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_login(
  p_email text,
  p_password_hash text,
  p_password_original text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_p        profiles%ROWTYPE;
  v_token    text;
  v_match    boolean := false;
  v_new_hash text;
  v_sha256   text;
BEGIN
  IF p_password_original IS NULL OR length(p_password_original) = 0 THEN
    RETURN jsonb_build_object('error', '郵箱或密碼錯誤');
  END IF;

  SELECT * INTO v_p FROM profiles WHERE email = lower(trim(p_email)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '郵箱或密碼錯誤'); END IF;

  IF v_p.password_hash IS NOT NULL AND v_p.password_hash LIKE '$2%' THEN
    v_match := (v_p.password_hash IS NOT DISTINCT FROM public.crypt_hash(p_password_original, v_p.password_hash));
  ELSIF v_p.password_hash IS NOT NULL AND length(v_p.password_hash) = 64 AND v_p.password_hash ~ '^[0-9a-f]+$' THEN
    v_sha256 := public.sha256_hex(p_password_original);
    v_match := (v_sha256 IS NOT NULL AND v_p.password_hash IS NOT DISTINCT FROM v_sha256);
    IF v_match THEN
      v_new_hash := public.crypt_hash(p_password_original, public.gen_bf_salt(10));
      UPDATE profiles SET password_hash = v_new_hash WHERE id = v_p.id;
    END IF;
  ELSE
    v_match := false;
  END IF;

  IF COALESCE(v_match, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '郵箱或密碼錯誤');
  END IF;

  IF v_p.is_blocked THEN
    RETURN jsonb_build_object('error', '此帳號已被停用。原因：' || COALESCE(v_p.blocked_reason, '違反使用規範'));
  END IF;

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
      'created_at', v_p.created_at,
      'membership_tier', v_p.membership_tier,
      'membership_number', v_p.membership_number,
      'is_lifetime', v_p.is_lifetime,
      'vip_upgrade_paid', v_p.vip_upgrade_paid,
      'vip_upgrade_at', v_p.vip_upgrade_at,
      'vip_deposit_paid', v_p.vip_deposit_paid,
      'vip_deposit_at', v_p.vip_deposit_at,
      'lock_reason', v_p.lock_reason
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_login(text, text, text) FROM PUBLIC, anon, authenticated;
