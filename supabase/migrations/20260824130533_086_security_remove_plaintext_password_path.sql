/*
  # Remove plaintext password storage and comparison (F4)

  One legacy account still stored its password as readable text, and rpc_login
  carried a final branch that compared the submitted password to the stored
  column verbatim.

  1. Re-hash any remaining non-bcrypt, non-sha256 password_hash value with
     bcrypt in place. The member's password keeps working, now through the
     bcrypt branch.
  2. Drop the plaintext comparison branch from rpc_login. The sha256 branch is
     kept: two accounts still need it and it upgrades them to bcrypt on login.
*/

UPDATE profiles
SET password_hash = public.crypt_hash(password_hash, public.gen_bf_salt(10))
WHERE password_hash IS NOT NULL
  AND password_hash NOT LIKE '$2%'
  AND NOT (length(password_hash) = 64 AND password_hash ~ '^[0-9a-f]+$');

CREATE OR REPLACE FUNCTION public.rpc_login(p_email text, p_password_hash text, p_password_original text DEFAULT NULL::text)
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

  -- Password first: nothing about the account is disclosed before it verifies.
  IF v_p.password_hash IS NOT NULL AND v_p.password_hash LIKE '$2%' THEN
    v_match := (v_p.password_hash = public.crypt_hash(p_password_original, v_p.password_hash));
  ELSIF v_p.password_hash IS NOT NULL AND length(v_p.password_hash) = 64 AND v_p.password_hash ~ '^[0-9a-f]+$' THEN
    v_sha256 := public.sha256_hex(p_password_original);
    v_match := (v_p.password_hash = v_sha256);
    IF v_match THEN
      v_new_hash := public.crypt_hash(p_password_original, public.gen_bf_salt(10));
      UPDATE profiles SET password_hash = v_new_hash WHERE id = v_p.id;
    END IF;
  ELSE
    -- No plaintext comparison: a stored value that is neither bcrypt nor sha256
    -- can never authenticate anybody.
    v_match := false;
  END IF;

  IF NOT v_match THEN RETURN jsonb_build_object('error', '郵箱或密碼錯誤'); END IF;

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
      'created_at', v_p.created_at
    )
  );
END;
$function$;
