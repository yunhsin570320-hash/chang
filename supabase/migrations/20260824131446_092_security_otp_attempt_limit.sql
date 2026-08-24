-- F12: the attempt limit tested the pre-increment value read into v_otp, so a
-- caller got six guesses instead of five. Test the value the increment produced.
CREATE OR REPLACE FUNCTION public.rpc_verify_otp(p_phone text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_otp  phone_otps%ROWTYPE;
v_attempts int;
BEGIN
p_phone := trim(p_phone);
p_code  := trim(p_code);

SELECT * INTO v_otp FROM phone_otps
WHERE phone = p_phone
AND verified = false
AND expires_at > now()
ORDER BY created_at DESC
LIMIT 1;

IF NOT FOUND THEN
RETURN jsonb_build_object('error', '驗證碼已過期或不存在，請重新取得');
END IF;

-- Count this attempt, then judge the resulting total.
UPDATE phone_otps SET attempts = attempts + 1
WHERE id = v_otp.id
RETURNING attempts INTO v_attempts;

IF COALESCE(v_attempts, 99) > 5 THEN
RETURN jsonb_build_object('error', '嘗試次數過多，請重新取得驗證碼');
END IF;

IF v_otp.code != p_code THEN
RETURN jsonb_build_object('error', '驗證碼錯誤，請重新輸入');
END IF;

-- Mark as verified
UPDATE phone_otps SET verified = true WHERE id = v_otp.id;

RETURN jsonb_build_object('success', true, 'verified', true);
END;
$function$;