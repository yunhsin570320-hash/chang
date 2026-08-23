-- Fix: crypt() and gen_salt() are also in extensions schema
-- Update rpc_login and sha256_hex to search extensions schema

-- Update sha256_hex to search extensions schema (already set but confirm)
CREATE OR REPLACE FUNCTION public.sha256_hex(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'extensions'
AS $function$
  SELECT encode(digest(input, 'sha256'), 'hex');
$function$;

-- Create wrapper for gen_salt
CREATE OR REPLACE FUNCTION public.gen_bf_salt(cost int DEFAULT 10)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'extensions'
AS $function$
  SELECT gen_salt('bf', cost);
$function$;

-- Create wrapper for crypt
CREATE OR REPLACE FUNCTION public.crypt_hash(pw text, salt text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'extensions'
AS $function$
  SELECT crypt(pw, salt);
$function$;

REVOKE EXECUTE ON FUNCTION public.gen_bf_salt(int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crypt_hash(text, text) FROM anon, authenticated;

-- Update rpc_login to use wrappers
CREATE OR REPLACE FUNCTION public.rpc_login(p_email text, p_password_hash text, p_password_original text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p        profiles%ROWTYPE;
  v_token    TEXT;
  v_match    BOOLEAN := false;
  v_new_hash TEXT;
  v_sha256   TEXT;
BEGIN
  SELECT * INTO v_p FROM profiles WHERE email = lower(trim(p_email)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '郵箱或密碼錯誤'); END IF;
  IF v_p.is_blocked THEN
    RETURN jsonb_build_object('error', '此帳號已被停用。原因：' || COALESCE(v_p.blocked_reason, '違反使用規範'));
  END IF;

  -- Try bcrypt verification first (new format passwords start with $2)
  IF v_p.password_hash IS NOT NULL AND v_p.password_hash LIKE '$2%' THEN
    v_match := (v_p.password_hash = public.crypt_hash(p_password_original, v_p.password_hash));
  ELSIF v_p.password_hash IS NOT NULL AND length(v_p.password_hash) = 64 AND v_p.password_hash ~ '^[0-9a-f]+$' THEN
    -- Legacy SHA-256: compute SHA-256 from plaintext on the server side
    v_sha256 := public.sha256_hex(p_password_original);
    v_match := (v_p.password_hash = v_sha256);
    -- Upgrade to bcrypt on successful match
    IF v_match THEN
      v_new_hash := public.crypt_hash(p_password_original, public.gen_bf_salt(10));
      UPDATE profiles SET password_hash = v_new_hash WHERE id = v_p.id;
    END IF;
  ELSE
    -- Very old format: plaintext comparison
    v_match := (v_p.password_hash = p_password_original);
    IF v_match THEN
      v_new_hash := public.crypt_hash(p_password_original, public.gen_bf_salt(10));
      UPDATE profiles SET password_hash = v_new_hash WHERE id = v_p.id;
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
$function$;

-- Also update rpc_register to use wrappers
CREATE OR REPLACE FUNCTION public.rpc_register(
  p_name text,
  p_email text,
  p_password_hash text,
  p_is_buyer boolean,
  p_is_seller boolean,
  p_phone text DEFAULT NULL,
  p_shipping_address text DEFAULT NULL,
  p_password_plain text DEFAULT NULL
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
BEGIN
  IF EXISTS(SELECT 1 FROM profiles WHERE email = lower(trim(p_email))) THEN
    RETURN jsonb_build_object('error', '此郵箱已被註冊');
  END IF;
  IF p_phone IS NOT NULL AND p_phone != '' AND EXISTS(SELECT 1 FROM profiles WHERE phone = p_phone) THEN
    RETURN jsonb_build_object('error', '此手機號碼已被其他帳戶使用');
  END IF;

  -- Use bcrypt for new passwords; fall back to client hash if plain not provided
  IF p_password_plain IS NOT NULL AND length(p_password_plain) > 0 THEN
    v_hashed_pw := public.crypt_hash(p_password_plain, public.gen_bf_salt(10));
  ELSE
    v_hashed_pw := p_password_hash;
  END IF;

  INSERT INTO profiles (
    name, email, password_hash, is_buyer, is_seller,
    role, phone, phone_verified, phone_verified_at, shipping_address
  ) VALUES (
    trim(p_name), lower(trim(p_email)), v_hashed_pw,
    p_is_buyer, p_is_seller,
    CASE WHEN p_is_seller THEN 'seller' ELSE 'buyer' END,
    NULLIF(trim(p_phone), ''),
    (p_phone IS NOT NULL AND trim(p_phone) != ''),
    CASE WHEN p_phone IS NOT NULL AND trim(p_phone) != '' THEN now() ELSE NULL END,
    NULLIF(trim(p_shipping_address), '')
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
