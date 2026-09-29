/*
# Return OTP code from rpc_send_otp for edge function use

1. Changes
- Add `code` to the JSON return value of `rpc_send_otp`.
- The edge function (send-sms-otp) needs the code to either send via SMS provider
  or display it in dev mode when no SMS credentials are configured.

2. Security
- `rpc_send_otp` is SECURITY DEFINER and its EXECUTE privilege has been revoked
  from anon and authenticated roles (migration 029/044). Only the service-role
  edge function can call it, so returning the code server-side is safe.
- The edge function never returns the code to the browser unless dev mode is
  active (no SMS credentials OR ALLOW_DEV_OTP=true).

3. Data safety
- No tables, columns, or rows are changed. Only the function's return shape
  gains one additional key.
*/

CREATE OR REPLACE FUNCTION public.rpc_send_otp(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

RETURN jsonb_build_object('success', true, 'otp_id', v_otp_id, 'code', v_code);
END;
$function$;

-- Ensure only service role can call this (re-grant EXECUTE to service_role explicitly)
REVOKE EXECUTE ON FUNCTION public.rpc_send_otp(text) FROM anon, authenticated;