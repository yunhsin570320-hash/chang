-- Fix rpc_login: compute SHA-256 server-side for legacy password verification
-- The previous fix sent p_password_hash as empty string, breaking all
-- accounts with SHA-256 stored hashes. Now the server computes SHA-256
-- from the plaintext password using pgcrypto's digest() function.

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
    v_match := (v_p.password_hash = crypt(p_password_original, v_p.password_hash));
  ELSIF v_p.password_hash IS NOT NULL AND length(v_p.password_hash) = 64 AND v_p.password_hash ~ '^[0-9a-f]+$' THEN
    -- Legacy SHA-256: compute SHA-256 from plaintext on the server side
    v_sha256 := encode(digest(p_password_original, 'sha256'), 'hex');
    v_match := (v_p.password_hash = v_sha256);
    -- Upgrade to bcrypt on successful match
    IF v_match THEN
      v_new_hash := crypt(p_password_original, gen_salt('bf', 10));
      UPDATE profiles SET password_hash = v_new_hash WHERE id = v_p.id;
    END IF;
  ELSE
    -- Very old format: plaintext comparison (should not exist but handle gracefully)
    v_match := (v_p.password_hash = p_password_original);
    IF v_match THEN
      v_new_hash := crypt(p_password_original, gen_salt('bf', 10));
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
