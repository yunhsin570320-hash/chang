/*
# Fix dashboard member counts to exclude admin accounts

## Problem
The dashboard RPC `rpc_admin_get_dashboard` counted `paid_members` and `lifetime_members`
by checking `membership_tier = 'vip'` and `is_lifetime = true` across ALL profiles —
including the admin account (which was seeded with `membership_tier = 'vip'`).

The member-list RPC `rpc_admin_get_members` excludes admin accounts (`WHERE is_admin IS NOT TRUE`),
so the admin dashboard overview showed "付費會員 1" while the paid-members tab showed 0 people.

## Fix
Add `is_admin IS NOT TRUE` to the `paid_members` and `lifetime_members` sub-queries
in `rpc_admin_get_dashboard` so both counts use the same population as the member list.

No data is modified; no tables or columns are changed.
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
    'blocked_users',      (SELECT count(*) FROM public.profiles WHERE is_blocked = true AND is_admin IS NOT TRUE),
    'online_count',       (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '5 minutes' AND is_admin IS NOT TRUE),
    'paid_members',       (SELECT count(*) FROM public.profiles WHERE membership_tier = 'vip' AND is_admin IS NOT TRUE),
    'lifetime_members',   (SELECT count(*) FROM public.profiles WHERE is_lifetime = true AND is_admin IS NOT TRUE),
    'total_products',     (SELECT count(*) FROM public.products),
    'flagged_products',   (SELECT count(*) FROM public.products WHERE is_flagged = true),
    'pending_reports',    (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'total_bids',         (SELECT count(*) FROM public.bids)
  ) INTO v_stats;

  RETURN jsonb_build_object('success', true) || v_stats;
END;
$function$;

-- Also fix the public member-stats RPC so the front page counter matches
CREATE OR REPLACE FUNCTION public.rpc_get_member_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_users int;
  v_online_count int;
  v_paid_members int;
  v_lifetime_members int;
BEGIN
  SELECT count(*) INTO v_total_users FROM profiles WHERE is_admin IS NOT TRUE;
  SELECT count(*) INTO v_online_count FROM profiles WHERE last_seen_at > now() - interval '5 minutes' AND is_admin IS NOT TRUE;
  SELECT count(*) INTO v_paid_members FROM profiles WHERE membership_tier = 'vip' AND is_admin IS NOT TRUE;
  SELECT count(*) INTO v_lifetime_members FROM profiles WHERE is_lifetime = true AND is_admin IS NOT TRUE;

  RETURN jsonb_build_object(
    'success', true,
    'total_users', v_total_users,
    'online_count', v_online_count,
    'paid_members', v_paid_members,
    'lifetime_members', v_lifetime_members
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_dashboard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_dashboard(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_dashboard(text) TO service_role;
