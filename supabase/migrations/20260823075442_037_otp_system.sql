-- OTP system for phone verification
-- Stores verification codes with expiry, rate limiting, and attempt limits

CREATE TABLE IF NOT EXISTS phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE phone_otps ENABLE ROW LEVEL SECURITY;

-- No direct access via API — all operations go through SECURITY DEFINER RPCs
CREATE POLICY "no_direct_select_phone_otps" ON phone_otps
  FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "no_direct_insert_phone_otps" ON phone_otps
  FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "no_direct_update_phone_otps" ON phone_otps
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "no_direct_delete_phone_otps" ON phone_otps
  FOR DELETE TO anon, authenticated USING (false);

-- Index for rate-limit lookups
CREATE INDEX idx_phone_otps_phone_created ON phone_otps (phone, created_at DESC);

-- Clean up expired codes periodically (called by send RPC)
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM phone_otps WHERE expires_at < now();
$function$;

-- RPC: Send OTP
-- Generates a 6-digit code, stores it with 10-minute expiry, returns the code
-- so the Edge Function can send it via SMS. Rate-limited to 1 per 60 seconds.
CREATE OR REPLACE FUNCTION public.rpc_send_otp(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code      TEXT;
  v_recent    int;
BEGIN
  p_phone := trim(p_phone);
  IF p_phone !~ '^09\d{8}$' THEN
    RETURN jsonb_build_object('error', '請輸入有效的台灣手機號碼（09xxxxxxxx）');
  END IF;

  -- Rate limit: max 1 request per 60 seconds, max 5 per hour
  SELECT count(*) INTO v_recent FROM phone_otps
  WHERE phone = p_phone AND created_at > now() - interval '60 seconds';
  IF v_recent > 0 THEN
    RETURN jsonb_build_object('error', '驗證碼請求過於頻繁，請60秒後再試');
  END IF;

  SELECT count(*) INTO v_recent FROM phone_otps
  WHERE phone = p_phone AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RETURN jsonb_build_object('error', '請求次數過多，請稍後再試');
  END IF;

  -- Clean up old expired codes
  PERFORM cleanup_expired_otps();

  -- Generate 6-digit code
  v_code := lpad(floor(random() * 1000000)::TEXT, 6, '0');

  INSERT INTO phone_otps (phone, code, expires_at)
  VALUES (p_phone, v_code, now() + interval '10 minutes');

  RETURN jsonb_build_object('success', true, 'code', v_code);
END;
$function$;

-- RPC: Verify OTP
-- Checks the code against the most recent unverified, unexpired OTP for this phone.
-- Max 5 attempts per code. Returns verified=true on success.
CREATE OR REPLACE FUNCTION public.rpc_verify_otp(p_phone text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_otp  phone_otps%ROWTYPE;
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

  -- Increment attempts
  UPDATE phone_otps SET attempts = attempts + 1 WHERE id = v_otp.id;

  IF v_otp.attempts >= 5 THEN
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

-- Revoke direct access from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.rpc_send_otp FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_verify_otp FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_otps FROM anon, authenticated;
