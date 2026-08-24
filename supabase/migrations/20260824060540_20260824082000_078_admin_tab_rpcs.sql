/*
# Add admin tab data RPCs

1. New Functions
- `rpc_admin_get_reports(p_token)` — returns all reports with reporter/reported user and product info.
- `rpc_admin_get_complaints(p_token)` — returns all complaints with user info.
- `rpc_admin_get_payment_requests(p_token)` — returns all payment requests with user info.
- `rpc_admin_get_action_log(p_token)` — returns recent admin action log with admin and target user names.

2. Security
- All functions are SECURITY DEFINER with search_path = public.
- Each validates the session token and requires admin role.
- No sensitive data (passwords, tokens) is returned.
*/

CREATE OR REPLACE FUNCTION public.rpc_admin_get_reports(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_is_admin boolean;
  v_reports  jsonb;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = v_admin_id;
  IF COALESCE(v_is_admin, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_reports
  FROM (
    SELECT
      rep.id, rep.type, rep.reason, rep.status, rep.created_at,
      rep.product_id, rep.reporter_id, rep.reported_user_id,
      reporter.id AS reporter_id, reporter.name AS reporter_name, reporter.email AS reporter_email,
      reported.id AS reported_user_id, reported.name AS reported_user_name, reported.email AS reported_email,
      reported.is_blocked AS reported_user_blocked,
      prod.id AS product_id, prod.name AS product_name
    FROM public.reports rep
    LEFT JOIN public.profiles reporter ON reporter.id = rep.reporter_id
    LEFT JOIN public.profiles reported ON reported.id = rep.reported_user_id
    LEFT JOIN public.products prod ON prod.id = rep.product_id
  ) r;

  RETURN jsonb_build_object('success', true, 'reports', v_reports);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_get_complaints(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id  uuid;
  v_is_admin  boolean;
  v_complaints jsonb;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = v_admin_id;
  IF COALESCE(v_is_admin, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_complaints
  FROM (
    SELECT
      comp.id, comp.reason, comp.status, comp.admin_response,
      comp.created_at, comp.resolved_at, comp.user_id,
      u.id AS user_id, u.name AS user_name, u.email AS user_email,
      u.is_blocked AS user_blocked, u.lock_reason
    FROM public.complaints comp
    LEFT JOIN public.profiles u ON u.id = comp.user_id
  ) c;

  RETURN jsonb_build_object('success', true, 'complaints', v_complaints);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_get_payment_requests(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_is_admin boolean;
  v_requests jsonb;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = v_admin_id;
  IF COALESCE(v_is_admin, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pr) ORDER BY pr.created_at DESC), '[]'::jsonb)
  INTO v_requests
  FROM (
    SELECT
      payreq.id, payreq.type, payreq.amount, payreq.payment_method,
      payreq.proof_image_url, payreq.status, payreq.admin_note,
      payreq.created_at, payreq.reviewed_at, payreq.user_id,
      u.id AS user_id, u.name AS user_name, u.email AS user_email
    FROM public.payment_requests payreq
    LEFT JOIN public.profiles u ON u.id = payreq.user_id
  ) pr;

  RETURN jsonb_build_object('success', true, 'payment_requests', v_requests);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_get_action_log(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_is_admin boolean;
  v_log      jsonb;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = v_admin_id;
  IF COALESCE(v_is_admin, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_log
  FROM (
    SELECT
      act.id, act.action_type, act.reason, act.created_at,
      admin.id AS admin_id, admin.name AS admin_name,
      target.id AS target_user_id, target.name AS target_user_name
    FROM public.admin_actions act
    LEFT JOIN public.profiles admin ON admin.id = act.admin_id
    LEFT JOIN public.profiles target ON target.id = act.target_user_id
    LIMIT 100
  ) a;

  RETURN jsonb_build_object('success', true, 'action_log', v_log);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_reports(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_reports(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_reports(text) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_admin_get_complaints(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_complaints(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_complaints(text) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_admin_get_payment_requests(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_payment_requests(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_payment_requests(text) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_admin_get_action_log(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_action_log(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_action_log(text) TO service_role;
