/*
# Fix admin grant seller role RPC

1. Problem
   - Previous migration used `sessions` table — actual table is `app_sessions`.
   - Rewrote to use the standard helper functions `app_get_user_id()` and `app_is_admin()` 
     consistent with all other admin RPCs.

2. Changes
   - Replaced manual session lookup with `app_get_user_id(p_token)`.
   - Replaced manual admin check with `app_is_admin(v_user_id)`.
   - Simplified target validation to cast directly.
*/

CREATE OR REPLACE FUNCTION public.rpc_admin_grant_seller_role(
  p_token text,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_target_id UUID;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '無效的工作階段');
  END IF;

  IF NOT public.app_is_admin(v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '無管理員權限');
  END IF;

  v_target_id := p_user_id::uuid;
  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '無效的會員 ID');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_target_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '找不到此會員');
  END IF;

  UPDATE public.profiles
  SET is_seller = true
  WHERE id = v_target_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_grant_seller_role(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_grant_seller_role(text, text) TO authenticated;
