/*
  # F4 — The bidding deposit can no longer be self-granted

  `rpc_pay_vip_deposit` set `vip_deposit_paid = true` after checking only the session,
  and it is reachable through the RPC proxy. Since `rpc_place_bid_v2` gates bidding on
  exactly that column, any signed-in user could unlock the bidding hall without paying
  the NT$1000 deposit and without the admin review the app's own flow requires.

  The function now requires an approved `payment_requests` row of type 'vip_deposit'.
*/

CREATE OR REPLACE FUNCTION public.rpc_pay_vip_deposit(
  p_token text,
  p_payment_method text DEFAULT NULL::text,
  p_payment_reference text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_profile profiles%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定，無法繳交保證金。請先申訴解鎖。');
  END IF;

  -- Deposit must have been submitted and approved by an admin.
  IF NOT EXISTS (
    SELECT 1 FROM payment_requests
    WHERE user_id = v_user_id
      AND type = 'vip_deposit'
      AND status = 'approved'
  ) THEN
    RETURN jsonb_build_object('error', '尚無已審核通過的保證金繳費紀錄，請先提交繳費證明。');
  END IF;

  UPDATE profiles
  SET vip_deposit_paid = true,
      vip_deposit_at = COALESCE(vip_deposit_at, now())
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_pay_vip_deposit(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_pay_vip_deposit(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_pay_vip_deposit(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_pay_vip_deposit(text, text, text) TO service_role;
