-- Drop rpc_login so we can recreate with the same signature
DROP FUNCTION IF EXISTS public.rpc_login(text, text, text);

-- Add failed login tracking columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS failed_login_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- Recreate rpc_login with account lockout + session invalidation
CREATE OR REPLACE FUNCTION public.rpc_login(
  p_email text,
  p_password_plain text DEFAULT NULL,
  p_password_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p             profiles%ROWTYPE;
  v_match         boolean := false;
  v_sha256        text;
  v_new_hash      text;
  v_password_original text;
  v_session_token text;
  v_now           timestamptz := now();
  v_failed_count  int;
BEGIN
  IF p_password_plain IS NOT NULL AND length(p_password_plain) > 0 THEN
    v_password_original := p_password_plain;
  ELSIF p_password_hash IS NOT NULL AND length(p_password_hash) = 64 AND p_password_hash ~ '^[0-9a-f]+$' THEN
    v_password_original := NULL;
  ELSE
    RETURN jsonb_build_object('error', '郵箱或密碼錯誤');
  END IF;

  SELECT * INTO v_p FROM profiles WHERE email = lower(trim(p_email)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '郵箱或密碼錯誤');
  END IF;

  -- Check account lock
  IF v_p.locked_until IS NOT NULL AND v_p.locked_until > v_now THEN
    RETURN jsonb_build_object('error', '帳號已暫時鎖定，請 ' || ceil(extract(epoch FROM (v_p.locked_until - v_now)) / 60)::text || ' 分鐘後再試');
  END IF;

  -- Verify password
  IF v_p.password_hash IS NOT NULL AND v_p.password_hash LIKE '$2%' THEN
    v_match := (v_p.password_hash IS NOT DISTINCT FROM public.crypt_hash(v_password_original, v_p.password_hash));
  ELSIF v_p.password_hash IS NOT NULL AND length(v_p.password_hash) = 64 AND v_p.password_hash ~ '^[0-9a-f]+$' THEN
    v_sha256 := public.sha256_hex(v_password_original);
    v_match := (v_sha256 IS NOT NULL AND v_p.password_hash IS NOT DISTINCT FROM v_sha256);
    IF v_match THEN
      v_new_hash := public.crypt_hash(v_password_original, public.gen_bf_salt(10));
      UPDATE profiles SET password_hash = v_new_hash WHERE id = v_p.id;
    END IF;
  ELSE
    v_match := false;
  END IF;

  IF NOT v_match THEN
    -- Increment failed login count and lock if threshold reached
    UPDATE profiles
    SET failed_login_count = failed_login_count + 1,
        locked_until = CASE
          WHEN failed_login_count + 1 >= 5 THEN v_now + interval '15 minutes'
          ELSE locked_until
        END
    WHERE id = v_p.id
    RETURNING failed_login_count INTO v_failed_count;

    -- Reset counter after lock triggers so the lockout window starts fresh
    IF v_failed_count >= 5 THEN
      UPDATE profiles SET failed_login_count = 0 WHERE id = v_p.id;
    END IF;

    RETURN jsonb_build_object('error', '郵箱或密碼錯誤');
  END IF;

  -- Check if blocked (after password verification to avoid info leak)
  IF COALESCE(v_p.is_blocked, false) THEN
    RETURN jsonb_build_object('error', '帳號已停權：' || COALESCE(v_p.blocked_reason, '違反平台規範'));
  END IF;

  -- Successful login: reset failed counter
  UPDATE profiles
  SET failed_login_count = 0,
      locked_until = NULL,
      last_seen_at = v_now
  WHERE id = v_p.id;

  -- Delete all existing sessions for this user (force single session)
  DELETE FROM app_sessions WHERE user_id = v_p.id;

  -- Create new session
  INSERT INTO app_sessions (user_id)
  VALUES (v_p.id)
  RETURNING token INTO v_session_token;

  RETURN jsonb_build_object(
    'token', v_session_token,
    'user', jsonb_build_object(
      'id', v_p.id,
      'name', v_p.name,
      'email', v_p.email,
      'is_buyer', v_p.is_buyer,
      'is_seller', v_p.is_seller,
      'is_admin', v_p.is_admin,
      'membership_tier', v_p.membership_tier,
      'is_lifetime', v_p.is_lifetime,
      'phone', v_p.phone,
      'phone_verified', v_p.phone_verified,
      'payment_method', v_p.payment_method,
      'bank_account', v_p.bank_account,
      'shipping_address', v_p.shipping_address,
      'is_blocked', COALESCE(v_p.is_blocked, false),
      'blocked_reason', v_p.blocked_reason,
      'warning_count', COALESCE(v_p.warning_count, 0),
      'vip_upgrade_paid', COALESCE(v_p.vip_upgrade_paid, false),
      'vip_deposit_paid', COALESCE(v_p.vip_deposit_paid, false),
      'membership_number', v_p.membership_number
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_login(text, text, text) FROM PUBLIC, anon, authenticated;

-- Drop and recreate rpc_send_otp with CSPRNG
DROP FUNCTION IF EXISTS public.rpc_send_otp(text);

CREATE OR REPLACE FUNCTION public.rpc_send_otp(
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_normalized   text;
  v_recent       int;
  v_code         text;
  v_otp_id       uuid;
  v_raw          bytea;
BEGIN
  v_normalized := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF v_normalized !~ '^09[0-9]{8}$' THEN
    RETURN jsonb_build_object('error', '請輸入有效的台灣手機號碼');
  END IF;

  -- Rate limit: 1 per 60 seconds, 5 per hour
  SELECT count(*) INTO v_recent FROM phone_otps
  WHERE phone = v_normalized AND created_at > now() - interval '60 seconds';
  IF v_recent > 0 THEN
    RETURN jsonb_build_object('error', '驗證碼發送過於頻繁，請稍候再試');
  END IF;

  SELECT count(*) INTO v_recent FROM phone_otps
  WHERE phone = v_normalized AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RETURN jsonb_build_object('error', '本小時驗證碼請求次數已達上限');
  END IF;

  -- Cryptographically secure 6-digit code using gen_random_bytes
  v_raw := gen_random_bytes(4);
  v_code := lpad(((get_byte(v_raw, 0) + get_byte(v_raw, 1) * 256 + get_byte(v_raw, 2) * 65536 + get_byte(v_raw, 3) * 16777216) % 1000000)::text, 6, '0');

  INSERT INTO phone_otps (phone, code, expires_at)
  VALUES (v_normalized, v_code, now() + interval '10 minutes')
  RETURNING id INTO v_otp_id;

  RETURN jsonb_build_object('success', true, 'otp_id', v_otp_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_otp(text) FROM PUBLIC, anon, authenticated;

-- Revoke new sensitive columns from client roles
REVOKE SELECT (failed_login_count, locked_until) ON public.profiles FROM anon, authenticated;
