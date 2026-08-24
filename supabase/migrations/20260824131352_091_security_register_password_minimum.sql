-- F11: registration accepted any non-empty password, while the reset flow already
-- required 8 characters. Enforce the same minimum at signup.
CREATE OR REPLACE FUNCTION public.rpc_register(p_name text, p_email text, p_password_hash text, p_is_buyer boolean, p_is_seller boolean, p_phone text DEFAULT NULL::text, p_shipping_address text DEFAULT NULL::text, p_password_plain text DEFAULT NULL::text)
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
IF p_email IS NULL OR position('@' in lower(trim(COALESCE(p_email, '')))) < 2 THEN
RETURN jsonb_build_object('error', '請輸入有效的電子郵件');
END IF;
IF p_name IS NULL OR length(trim(p_name)) = 0 OR length(trim(p_name)) > 100 THEN
RETURN jsonb_build_object('error', '請輸入有效的姓名');
END IF;

-- Password policy: the same 8 character minimum the reset flow enforces.
IF p_password_plain IS NOT NULL AND length(p_password_plain) > 0 THEN
IF length(p_password_plain) < 8 THEN
RETURN jsonb_build_object('error', '密碼至少需要8個字元');
END IF;
v_hashed_pw := public.crypt_hash(p_password_plain, public.gen_bf_salt(10));
ELSE
-- Legacy client that only sends a sha256 digest: the digest itself must be well formed.
IF p_password_hash IS NULL OR NOT (length(p_password_hash) = 64 AND p_password_hash ~ '^[0-9a-f]+$') THEN
RETURN jsonb_build_object('error', '密碼格式不正確，請重新整理頁面後再試');
END IF;
v_hashed_pw := p_password_hash;
END IF;

IF EXISTS(SELECT 1 FROM profiles WHERE email = lower(trim(p_email))) THEN
RETURN jsonb_build_object('error', '此郵箱已被註冊');
END IF;
IF v_phone IS NOT NULL AND EXISTS(
  SELECT 1 FROM profiles
  WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g')
) THEN
RETURN jsonb_build_object('error', '此手機號碼已被其他帳戶使用');
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