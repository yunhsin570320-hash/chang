/*
# Add secure admin member list RPC

1. New Functions
- `rpc_admin_get_members(p_token)` returns the member rows required by the admin member-management screen.

2. Behavior
- Validates the existing application session token with `app_get_user_id`.
- Requires the session owner to be an administrator.
- Excludes administrator accounts from the returned member list.
- Returns only display, contact, moderation, membership, and payment-status fields needed by the screen.

3. Security
- The function runs as `SECURITY DEFINER` with a fixed `public` search path.
- Invalid sessions and non-admin sessions receive a generic authorization response.
- No password hashes, session tokens, or other authentication secrets are returned.
- Execution is available through the existing RPC proxy, while direct anonymous database execution is revoked.

4. Important Notes
- This replaces the broken direct `profiles` table query, which was incompatible with the app's custom session authentication and row-level security.
- Existing member data is not modified or deleted.
*/

CREATE OR REPLACE FUNCTION public.rpc_admin_get_members(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_is_admin boolean;
  v_members jsonb;
BEGIN
  v_admin_id := app_get_user_id(p_token);

  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期');
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM public.profiles
  WHERE id = v_admin_id;

  IF COALESCE(v_is_admin, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(member_row) ORDER BY member_row.created_at DESC), '[]'::jsonb)
  INTO v_members
  FROM (
    SELECT
      id,
      name,
      email,
      is_admin,
      is_blocked,
      is_buyer,
      is_seller,
      phone,
      phone_verified,
      warning_count,
      blocked_reason,
      created_at,
      membership_tier,
      membership_number,
      is_lifetime,
      vip_upgrade_paid,
      vip_deposit_paid
    FROM public.profiles
    WHERE is_admin IS NOT TRUE
  ) AS member_row;

  RETURN jsonb_build_object('success', true, 'members', v_members);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_members(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_members(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_members(text) TO service_role;
