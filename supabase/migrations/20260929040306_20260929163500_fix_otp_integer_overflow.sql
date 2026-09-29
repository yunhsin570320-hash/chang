/*
# Fix integer overflow in rpc_send_otp random code generation

1. Problem
- The 4-byte multiplication (get_byte * 16777216) overflows Postgres integer.

2. Fix
- Use two bytes and modulo 1000000 to get a 6-digit code, avoiding overflow.
- Cast intermediate results to bigint.
*/

CREATE OR REPLACE FUNCTION public.rpc_send_otp(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

v_raw := extensions.gen_random_bytes(4);
v_code := lpad(((get_byte(v_raw, 0)::bigint + get_byte(v_raw, 1)::bigint * 256 + get_byte(v_raw, 2)::bigint * 65536 + get_byte(v_raw, 3)::bigint * 16777216) % 1000000)::text, 6, '0');

INSERT INTO phone_otps (phone, code, expires_at)
VALUES (v_normalized, v_code, now() + interval '10 minutes')
RETURNING id INTO v_otp_id;

RETURN jsonb_build_object('success', true, 'otp_id', v_otp_id, 'code', v_code);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_otp(text) FROM anon, authenticated;