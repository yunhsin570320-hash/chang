/*
# Add admin dashboard stats RPC

1. New Functions
- `rpc_admin_get_dashboard(p_token)` returns aggregate counts for the admin dashboard overview.

2. Behavior
- Validates the session token and requires admin role.
- Returns counts: total_users, blocked_users, online_count, paid_members, lifetime_members,
  total_products, flagged_products, pending_reports, total_bids.

3. Security
- SECURITY DEFINER with fixed search_path = public.
- Non-admin sessions receive a generic authorization error.
- No sensitive user data is returned — only aggregate counts.
*/

CREATE OR REPLACE FUNCTION public.rpc_admin_get_dashboard(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id    uuid;
  v_is_admin    boolean;
  v_stats       jsonb;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期');
  END IF;

  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = v_admin_id;
  IF COALESCE(v_is_admin, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT jsonb_build_object(
    'total_users',        (SELECT count(*) FROM public.profiles WHERE is_admin IS NOT TRUE),
    'blocked_users',      (SELECT count(*) FROM public.profiles WHERE is_blocked = true),
    'online_count',       (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '5 minutes'),
    'paid_members',       (SELECT count(*) FROM public.profiles WHERE membership_tier = 'vip'),
    'lifetime_members',   (SELECT count(*) FROM public.profiles WHERE is_lifetime = true),
    'total_products',     (SELECT count(*) FROM public.products),
    'flagged_products',   (SELECT count(*) FROM public.products WHERE is_flagged = true),
    'pending_reports',    (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'total_bids',         (SELECT count(*) FROM public.bids)
  ) INTO v_stats;

  RETURN jsonb_build_object('success', true) || v_stats;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_dashboard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_dashboard(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_dashboard(text) TO service_role;
