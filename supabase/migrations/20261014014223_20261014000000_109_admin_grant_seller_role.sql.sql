/*
# Admin Grant Seller Role RPC

1. Purpose
   - Allows admin to grant seller role (is_seller = true) to any existing member.
   - This solves the issue where users who registered as buyer-only cannot become sellers later.
   - Admin can add seller capability from the admin member management panel.

2. New RPC
   - `rpc_admin_grant_seller_role(p_token text, p_user_id text)`:
     - Validates the caller is an admin via session token.
     - Sets `is_seller = true` on the target profile.
     - Returns `{ success: boolean, error?: text }`.

3. Security
   - Only admin sessions can call this RPC (validated via rpc_validate_session).
   - The function is SECURITY DEFINER with a locked search_path.
   - No new tables or columns — only updates existing `is_seller` boolean.
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
  v_session record;
  v_target_id uuid;
BEGIN
  -- Validate admin session
  SELECT * INTO v_session FROM public.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '無效的工作階段');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_session.user_id AND is_admin = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '無管理員權限');
  END IF;

  -- Validate target user id
  v_target_id := p_user_id::uuid;
  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '無效的會員 ID');
  END IF;

  -- Check target exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_target_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '找不到此會員');
  END IF;

  -- Grant seller role
  UPDATE public.profiles
  SET is_seller = true
  WHERE id = v_target_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Revoke from anon, grant to authenticated only
REVOKE EXECUTE ON FUNCTION public.rpc_admin_grant_seller_role(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_grant_seller_role(text, text) TO authenticated;
