/*
  # F9 — Phone verification is decided by the server, not by the browser

  `rpc_update_profile` accepted `p_phone_verified` and `p_phone_verified_at` from the
  caller and wrote them straight to the profile, so any signed-in user could mark any
  phone number they typed as verified. The profile screen's "verification" also
  generated and compared the code in the browser, so no code was ever sent.

  Both parameters are now ignored. The flag is derived from a `phone_otps` row that was
  verified server-side for the number being saved, and that row is consumed so it
  cannot be reused. An unchanged phone number keeps its existing state, and saving a
  new number without a verified code simply leaves it unverified rather than failing.
*/

CREATE OR REPLACE FUNCTION public.rpc_update_profile(
  p_token text,
  p_phone text DEFAULT NULL::text,
  p_payment_method text DEFAULT NULL::text,
  p_bank_account text DEFAULT NULL::text,
  p_shipping_address text DEFAULT NULL::text,
  p_phone_verified boolean DEFAULT NULL::boolean,
  p_phone_verified_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_current   profiles%ROWTYPE;
  v_new_phone text;
  v_otp_id    uuid;
  v_verified  boolean;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

  SELECT * INTO v_current FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;

  v_new_phone := NULLIF(TRIM(COALESCE(p_phone, '')), '');

  IF v_new_phone IS NOT NULL AND EXISTS(
    SELECT 1 FROM profiles WHERE phone = v_new_phone AND id != v_user_id
  ) THEN
    RETURN jsonb_build_object('error', '此手機號碼已被其他帳戶使用');
  END IF;

  -- p_phone_verified / p_phone_verified_at are deliberately ignored: verification
  -- state is only ever established from a server-verified one-time code.
  IF v_new_phone IS NULL THEN
    v_verified := false;
  ELSIF v_new_phone = v_current.phone THEN
    v_verified := COALESCE(v_current.phone_verified, false);
  ELSE
    SELECT id INTO v_otp_id
    FROM phone_otps
    WHERE phone = v_new_phone
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

  UPDATE profiles SET
    phone             = v_new_phone,
    payment_method    = NULLIF(TRIM(COALESCE(p_payment_method, '')), ''),
    bank_account      = NULLIF(TRIM(COALESCE(p_bank_account, '')), ''),
    shipping_address  = NULLIF(TRIM(COALESCE(p_shipping_address, '')), ''),
    phone_verified    = v_verified,
    phone_verified_at = CASE
                          WHEN v_verified AND v_new_phone = v_current.phone THEN phone_verified_at
                          WHEN v_verified THEN now()
                          ELSE NULL
                        END
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'phone_verified', v_verified);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_update_profile(text, text, text, text, text, boolean, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_update_profile(text, text, text, text, text, boolean, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_update_profile(text, text, text, text, text, boolean, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_profile(text, text, text, text, text, boolean, timestamptz) TO service_role;
