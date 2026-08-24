/*
  # F2 / F21 — Password reset no longer returns the reset key, and no longer confirms account existence

  Before: `rpc_request_password_reset(email, phone)` returned the reset token in its
  JSON response, and `rpc_reset_password(token, new_password)` accepted that token
  alone. Anyone who knew a victim's email and phone number could therefore reset the
  password directly, skipping the one-time code the UI asks for (which was only ever
  checked in the browser). The same function also returned three different answers for
  match / no-match / blocked, which let anyone enumerate accounts.

  After:
  - `rpc_request_password_reset` always returns the same generic success and never
    returns a token.
  - `rpc_reset_password_v2(email, phone, code, new_password)` requires a code that was
    verified server-side against `phone_otps` for that account's phone number, and
    claims it atomically so it cannot be replayed.
  - the old token-based `rpc_reset_password` is neutralised.
*/

ALTER TABLE public.phone_otps ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE OR REPLACE FUNCTION public.rpc_request_password_reset(p_email text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile profiles%ROWTYPE;
  v_email   text := lower(trim(COALESCE(p_email, '')));
  v_phone   text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  -- Look the account up but never disclose the outcome: the response is identical
  -- whether or not the email/phone pair exists, so accounts cannot be enumerated.
  SELECT * INTO v_profile
  FROM profiles
  WHERE email = v_email
    AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_phone
  LIMIT 1;

  IF FOUND AND NOT COALESCE(v_profile.is_blocked, false) THEN
    UPDATE profiles
    SET reset_token = gen_random_uuid(),
        reset_token_expires_at = now() + interval '10 minutes'
    WHERE id = v_profile.id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_request_password_reset(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_request_password_reset(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_request_password_reset(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_request_password_reset(text, text) TO service_role;

-- New reset step: requires a server-verified, single-use SMS code for the account phone
CREATE OR REPLACE FUNCTION public.rpc_reset_password_v2(
  p_email text,
  p_phone text,
  p_code text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile profiles%ROWTYPE;
  v_otp     phone_otps%ROWTYPE;
  v_email   text := lower(trim(COALESCE(p_email, '')));
  v_phone   text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_code    text := trim(COALESCE(p_code, ''));
  v_claimed int;
BEGIN
  IF length(COALESCE(p_new_password, '')) < 8 THEN
    RETURN jsonb_build_object('error', '密碼至少需要8個字元');
  END IF;

  SELECT * INTO v_profile
  FROM profiles
  WHERE email = v_email
    AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_phone
  LIMIT 1;

  IF NOT FOUND OR COALESCE(v_profile.is_blocked, false) THEN
    RETURN jsonb_build_object('error', '驗證碼錯誤或已過期，請重新申請');
  END IF;

  SELECT * INTO v_otp
  FROM phone_otps
  WHERE phone = v_phone
    AND code = v_code
    AND verified = true
    AND consumed_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '驗證碼錯誤或已過期，請重新申請');
  END IF;

  -- Atomic single-use claim: two concurrent callers cannot both pass this.
  UPDATE phone_otps SET consumed_at = now()
  WHERE id = v_otp.id AND consumed_at IS NULL;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN jsonb_build_object('error', '驗證碼錯誤或已過期，請重新申請');
  END IF;

  UPDATE profiles
  SET password_hash = public.crypt_hash(p_new_password, public.gen_bf_salt(10)),
      reset_token = NULL,
      reset_token_expires_at = NULL
  WHERE id = v_profile.id;

  -- Invalidate every existing session for this account.
  DELETE FROM app_sessions WHERE user_id = v_profile.id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_reset_password_v2(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_reset_password_v2(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_reset_password_v2(text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reset_password_v2(text, text, text, text) TO service_role;

-- Neutralise the token-only reset path.
CREATE OR REPLACE FUNCTION public.rpc_reset_password(p_reset_token uuid, p_new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('error', '此重設方式已停用，請重新申請密碼重設');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_reset_password(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_reset_password(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_reset_password(uuid, text) FROM authenticated;
