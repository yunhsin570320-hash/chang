/*
  # F10 — Registration no longer records an unverified phone number as verified

  Both `rpc_register` overloads set `phone_verified = true` and a verification
  timestamp whenever a phone number was supplied, so the flag carried no meaning.
  It is now derived from a `phone_otps` row that was verified server-side for that
  number, and that row is consumed on use. Accounts registered without a code are
  simply unverified.
*/

CREATE OR REPLACE FUNCTION public.rpc_register(
  p_name text,
  p_email text,
  p_password_hash text,
  p_is_buyer boolean,
  p_is_seller boolean,
  p_phone text DEFAULT NULL::text,
  p_shipping_address text DEFAULT NULL::text,
  p_password_plain text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_token     TEXT;
  v_user      JSONB;
  v_hashed_pw TEXT;
  v_phone     TEXT := NULLIF(trim(COALESCE(p_phone, '')), '');
  v_otp_id    uuid;
  v_verified  boolean := false;
BEGIN
  IF EXISTS(SELECT 1 FROM profiles WHERE email = lower(trim(p_email))) THEN
    RETURN jsonb_build_object('error', '此郵箱已被註冊');
  END IF;
  IF v_phone IS NOT NULL AND EXISTS(SELECT 1 FROM profiles WHERE phone = v_phone) THEN
    RETURN jsonb_build_object('error', '此手機號碼已被其他帳戶使用');
  END IF;

  IF p_password_plain IS NOT NULL AND length(p_password_plain) > 0 THEN
    v_hashed_pw := public.crypt_hash(p_password_plain, public.gen_bf_salt(10));
  ELSE
    v_hashed_pw := p_password_hash;
  END IF;

  -- Verified state only ever comes from a server-verified one-time code.
  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_otp_id
    FROM phone_otps
    WHERE phone = v_phone
      AND verified = true
      AND consumed_at IS NULL
      AND created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    v_verified := v_otp_id IS NOT NULL;
    IF v_otp_id IS NOT NULL THEN
      UPDATE phone_otps SET consumed_at = now() WHERE id = v_otp_id AND consumed_at IS NULL;
    END IF;
  END IF;

  INSERT INTO profiles (
    name, email, password_hash, is_buyer, is_seller,
    role, phone, phone_verified, phone_verified_at, shipping_address
  ) VALUES (
    trim(p_name), lower(trim(p_email)), v_hashed_pw,
    p_is_buyer, p_is_seller,
    CASE WHEN p_is_seller THEN 'seller' ELSE 'buyer' END,
    v_phone,
    v_verified,
    CASE WHEN v_verified THEN now() ELSE NULL END,
    NULLIF(trim(COALESCE(p_shipping_address, '')), '')
  ) RETURNING id INTO v_user_id;

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
$function$;

-- Neutralise the older 7-argument overload, which also auto-verified the phone and
-- stored a client-supplied password hash verbatim.
CREATE OR REPLACE FUNCTION public.rpc_register(
  p_name text,
  p_email text,
  p_password_hash text,
  p_is_buyer boolean,
  p_is_seller boolean,
  p_phone text DEFAULT NULL::text,
  p_shipping_address text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('error', '註冊方式已更新，請重新整理頁面後再試');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_register(text, text, text, boolean, boolean, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_register(text, text, text, boolean, boolean, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_register(text, text, text, boolean, boolean, text, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.rpc_register(text, text, text, boolean, boolean, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_register(text, text, text, boolean, boolean, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_register(text, text, text, boolean, boolean, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_register(text, text, text, boolean, boolean, text, text, text) TO service_role;
