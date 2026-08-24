/*
  # F3 — VIP membership can no longer be self-granted

  `rpc_upgrade_vip_seller` set `membership_tier = 'vip'` and `vip_upgrade_paid = true`
  after checking only that the caller had a valid session. It is reachable through the
  RPC proxy, so any signed-in user could grant themselves paid VIP membership for free,
  bypassing the intended flow of `rpc_submit_payment_request` followed by an admin
  review in `rpc_admin_review_payment_request`.

  The function now requires an approved `payment_requests` row of type 'vip_upgrade'
  for the caller. The admin review path already flips the flags itself, so this
  function becomes a safe no-op for anyone who has not paid.
*/

CREATE OR REPLACE FUNCTION public.rpc_upgrade_vip_seller(
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
    RETURN jsonb_build_object('error', '帳號已鎖定，無法升級。請先申訴解鎖。');
  END IF;

  -- Payment must have been submitted and approved by an admin.
  IF NOT EXISTS (
    SELECT 1 FROM payment_requests
    WHERE user_id = v_user_id
      AND type = 'vip_upgrade'
      AND status = 'approved'
  ) THEN
    RETURN jsonb_build_object('error', '尚無已審核通過的升級繳費紀錄，請先提交繳費證明。');
  END IF;

  UPDATE profiles
  SET membership_tier = 'vip',
      vip_upgrade_paid = true,
      vip_upgrade_at = COALESCE(vip_upgrade_at, now())
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'membership_tier', 'vip');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_upgrade_vip_seller(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_upgrade_vip_seller(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_upgrade_vip_seller(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upgrade_vip_seller(text, text, text) TO service_role;
