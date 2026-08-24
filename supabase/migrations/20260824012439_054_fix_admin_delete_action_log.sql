/*
# Fix: Admin delete products — admin_action_log table doesn't exist

## Bug
Both rpc_admin_delete_product and rpc_admin_delete_ended_products insert
into `admin_action_log` which does not exist in the database. Only
`admin_actions` exists. This causes a runtime error AFTER the DELETE
succeeds, which rolls back the entire transaction (PL/pgSQL default
behavior on unhandled exceptions), so the product is not actually deleted.

## Fix
- Replace `admin_action_log` with `admin_actions`
- Use the correct columns: admin_id, target_user_id (NULL), product_id,
  action_type, reason
- For the single delete: log BEFORE the DELETE so product_id is still valid
  (admin_actions FK is SET NULL on delete, so logging after also works,
  but logging before is cleaner and preserves the product_id)
- For the batch delete: log with product_id = NULL since multiple products
  are deleted and we only have a count
*/

CREATE OR REPLACE FUNCTION public.rpc_admin_delete_product(
  p_token text,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id        uuid;
  v_is_admin        boolean;
  v_product_name    text;
  v_product_status  text;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_admin_id LIMIT 1;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', '無管理員權限');
  END IF;

  SELECT name, status INTO v_product_name, v_product_status
  FROM products WHERE id = p_product_id LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '商品不存在');
  END IF;

  IF v_product_status <> 'ended' THEN
    RETURN jsonb_build_object('error', '只能刪除已結標的商品');
  END IF;

  -- Log the action BEFORE deleting (so product_id FK is valid)
  INSERT INTO admin_actions (admin_id, target_user_id, product_id, action_type, reason)
  VALUES (
    v_admin_id,
    NULL,
    p_product_id,
    'delete_product',
    '刪除已結標商品：' || v_product_name
  );

  -- Delete bids first (CASCADE would handle this, but explicit is safe)
  DELETE FROM bids WHERE product_id = p_product_id;

  -- Delete the product (deliveries CASCADE, notifications/reports SET NULL,
  -- admin_actions SET NULL on product_id)
  DELETE FROM products WHERE id = p_product_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_delete_ended_products(
  p_token text,
  p_older_than_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id    uuid;
  v_is_admin    boolean;
  v_count       int;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_admin_id LIMIT 1;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', '無管理員權限');
  END IF;

  IF p_older_than_days < 1 THEN
    RETURN jsonb_build_object('error', '天數至少為1天');
  END IF;

  -- Delete bids for ended products older than the threshold
  DELETE FROM bids
  WHERE product_id IN (
    SELECT id FROM products
    WHERE status = 'ended'
      AND end_time < now() - (p_older_than_days || ' days')::interval
  );

  -- Delete the ended products
  WITH deleted AS (
    DELETE FROM products
    WHERE status = 'ended'
      AND end_time < now() - (p_older_than_days || ' days')::interval
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;

  -- Log the action (product_id = NULL since multiple products deleted)
  INSERT INTO admin_actions (admin_id, target_user_id, product_id, action_type, reason)
  VALUES (
    v_admin_id,
    NULL,
    NULL,
    'batch_delete_ended',
    '批次刪除 ' || v_count || ' 件已結標商品（超過 ' || p_older_than_days || ' 天）'
  );

  RETURN jsonb_build_object('success', true, 'deleted_count', v_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_product(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_ended_products(text, int) FROM PUBLIC, anon, authenticated;
