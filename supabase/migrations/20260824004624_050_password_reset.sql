/*
# Password Reset RPC

## Overview
Allows a user to reset their password when they know their registered email
and phone number. The flow is:
1. User provides email + phone → RPC verifies the match, returns a temporary
   reset token (UUID).
2. User receives OTP via SMS (existing send-sms-otp + rpc_verify_otp flow).
3. User calls rpc_reset_password with the reset token + new password.

The reset token is stored in a new column `reset_token` on profiles with an
expiry of 10 minutes.

## Changes
- profiles: add `reset_token` (uuid) + `reset_token_expires_at` (timestamptz)
- rpc_request_password_reset: verify email+phone match, issue reset token
- rpc_reset_password: verify reset token not expired, set new bcrypt password
*/

-- Add reset token columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reset_token uuid;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz;

-- ============================================================
-- RPC: Request password reset
-- Verifies email + phone match, issues a 10-minute reset token
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_request_password_reset(
  p_email text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile profiles%ROWTYPE;
  v_token   uuid;
BEGIN
  SELECT * INTO v_profile
  FROM profiles
  WHERE email = lower(trim(p_email))
    AND phone = trim(p_phone)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '郵箱與手機號碼不相符，請確認後再試');
  END IF;

  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '此帳號已被停用，請聯繫管理員');
  END IF;

  v_token := gen_random_uuid();

  UPDATE profiles
  SET reset_token = v_token,
      reset_token_expires_at = now() + interval '10 minutes'
  WHERE id = v_profile.id;

  RETURN jsonb_build_object('success', true, 'reset_token', v_token);
END;
$function$;

-- ============================================================
-- RPC: Reset password with token
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_reset_password(
  p_reset_token uuid,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile profiles%ROWTYPE;
  v_new_hash text;
BEGIN
  IF length(p_new_password) < 8 THEN
    RETURN jsonb_build_object('error', '密碼至少需要8個字元');
  END IF;

  SELECT * INTO v_profile
  FROM profiles
  WHERE reset_token = p_reset_token
    AND reset_token_expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '重設連結已過期或無效，請重新申請');
  END IF;

  v_new_hash := crypt(p_new_password, gen_salt('bf', 10));

  UPDATE profiles
  SET password_hash = v_new_hash,
      reset_token = NULL,
      reset_token_expires_at = NULL
  WHERE id = v_profile.id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Revoke direct execute (accessed via rpc-proxy)
REVOKE EXECUTE ON FUNCTION public.rpc_request_password_reset(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_reset_password(uuid, text) FROM PUBLIC, anon, authenticated;
