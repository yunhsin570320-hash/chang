/*
  # Blocking an account must end its sessions (F3)

  `app_get_user_id` only checked the token and its expiry, so a blocked member
  kept full access through the session already in their browser for up to the
  30 day token lifetime. `rpc_login` already refuses a blocked account, so
  rejecting a blocked account here is consistent with the intended behaviour.

  1. `app_get_user_id` now resolves only sessions belonging to accounts that are
     not blocked. This is the single choke point used by every RPC.
  2. Both administrator block paths delete the target's sessions.
*/

CREATE OR REPLACE FUNCTION public.app_get_user_id(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.user_id
  FROM app_sessions s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND NOT COALESCE(p.is_blocked, false)
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_lock_user(p_token text, p_target_user_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_admin    profiles%ROWTYPE;
  v_target   profiles%ROWTYPE;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_admin FROM profiles WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT * INTO v_target FROM profiles WHERE id = p_target_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;

  UPDATE profiles
  SET is_blocked = true,
      lock_reason = p_reason,
      locked_at = now(),
      blocked_reason = p_reason
  WHERE id = p_target_user_id;

  -- Revoke every existing session: a block that leaves the token working is not a block.
  DELETE FROM app_sessions WHERE user_id = p_target_user_id;

  INSERT INTO admin_actions (admin_id, target_user_id, action_type, reason)
  VALUES (v_admin_id, p_target_user_id, 'block', p_reason);

  INSERT INTO notifications (user_id, type, title, message, is_read)
  VALUES (p_target_user_id, 'won', '帳號已鎖定',
    '您的帳號已因「' || p_reason || '」被鎖定。如認為有誤，請至會員中心提出申訴。', false);

  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_action(p_token text, p_action_type text, p_target_type text, p_target_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_target_user_id UUID := NULL;
  v_product_id     UUID := NULL;
  v_report         reports%ROWTYPE;
  v_warn_count     INTEGER;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;
  IF NOT app_is_admin(v_user_id) THEN RETURN jsonb_build_object('error', 'Not authorized'); END IF;

  IF p_target_type = 'user' THEN
    v_target_user_id := p_target_id;
  ELSIF p_target_type = 'product' THEN
    v_product_id := p_target_id;
  ELSIF p_target_type = 'report' THEN
    SELECT * INTO v_report FROM reports WHERE id = p_target_id;
    v_target_user_id := v_report.reported_user_id;
  END IF;

  IF p_action_type = 'warn' THEN
    SELECT COALESCE(warning_count, 0) + 1 INTO v_warn_count FROM profiles WHERE id = p_target_id;
    UPDATE profiles SET warning_count = v_warn_count WHERE id = p_target_id;
    INSERT INTO notifications (user_id, type, title, message, is_read)
    VALUES (p_target_id, 'auction_ended', '帳號警告通知',
      '您的帳號已收到管理員警告。原因：' || p_reason, false);

  ELSIF p_action_type = 'block' THEN
    UPDATE profiles SET is_blocked = true, blocked_reason = p_reason, blocked_at = now()
    WHERE id = p_target_id;
    UPDATE products SET status = 'ended' WHERE seller_id = p_target_id AND status = 'active';
    -- Revoke every existing session for the blocked account.
    DELETE FROM app_sessions WHERE user_id = p_target_id;

  ELSIF p_action_type = 'unblock' THEN
    UPDATE profiles SET is_blocked = false, blocked_reason = NULL, blocked_at = NULL
    WHERE id = p_target_id;

  ELSIF p_action_type = 'remove_product' THEN
    UPDATE products SET status = 'ended', is_flagged = true, flag_reason = p_reason, is_approved = false
    WHERE id = p_target_id;

  ELSIF p_action_type = 'approve_product' THEN
    UPDATE products SET is_flagged = false, flag_reason = NULL, is_approved = true
    WHERE id = p_target_id;

  ELSIF p_action_type IN ('resolve_report', 'dismiss_report') THEN
    IF v_report.id IS NULL THEN SELECT * INTO v_report FROM reports WHERE id = p_target_id; END IF;
    UPDATE reports SET
      status      = CASE WHEN p_action_type = 'resolve_report' THEN 'resolved' ELSE 'dismissed' END,
      resolved_by = v_user_id,
      resolved_at = now(),
      admin_note  = p_reason
    WHERE id = p_target_id;
    IF v_report.reporter_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
      VALUES (
        v_report.reporter_id, v_report.product_id, 'auction_ended',
        CASE WHEN p_action_type = 'resolve_report' THEN '您的檢舉已受理' ELSE '您的檢舉已審閱' END,
        CASE WHEN p_action_type = 'resolve_report'
          THEN '您的檢舉已由管理員受理並採取行動。管理員備註：' || p_reason
          ELSE '您的檢舉經審閱後暫不採取行動。管理員備註：' || p_reason
        END,
        false
      );
    END IF;
  ELSE
    RETURN jsonb_build_object('error', 'Unknown action type');
  END IF;

  INSERT INTO admin_actions (admin_id, target_user_id, product_id, action_type, reason)
  VALUES (v_user_id, v_target_user_id, v_product_id, p_action_type, p_reason);

  RETURN jsonb_build_object('success', true);
END;
$function$;
