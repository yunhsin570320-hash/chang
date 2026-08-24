/*
# Fix: Admin delete ended products — variable reuse + wrong column name

## Bugs
1. rpc_admin_delete_product: `SELECT is_admin INTO v_admin_id` overwrites
   the admin's UUID with a boolean. PostgreSQL cannot cast boolean→uuid,
   so the function errors out for every admin call.

2. rpc_admin_delete_ended_products: same variable reuse bug.

3. rpc_admin_delete_ended_products: references `auction_end_time` which
   does not exist on the products table — the actual column is `end_time`.
   This causes a column-not-found error.

## Fix
- Use a separate `v_is_admin boolean` variable for the admin check.
- Replace `auction_end_time` with `end_time` in the batch delete function.
*/

-- ============================================================
-- Fix 1: rpc_admin_delete_product — separate admin check variable
-- ============================================================
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

  -- Delete bids first (no FK constraint)
  DELETE FROM bids WHERE product_id = p_product_id;

  -- Delete the product (deliveries CASCADE, notifications/reports SET NULL)
  DELETE FROM products WHERE id = p_product_id;

  -- Log the action
  INSERT INTO admin_action_log (admin_id, action_type, target_type, target_id, description)
  VALUES (
    v_admin_id,
    'delete_product',
    'product',
    p_product_id,
    '刪除已結標商品：' || v_product_name
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- Fix 2+3: rpc_admin_delete_ended_products — fix variable + column name
-- ============================================================
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

  -- Log the action
  INSERT INTO admin_action_log (admin_id, action_type, target_type, description)
  VALUES (
    v_admin_id,
    'batch_delete_ended',
    'product',
    '批次刪除 ' || v_count || ' 件已結標商品（超過 ' || p_older_than_days || ' 天）'
  );

  RETURN jsonb_build_object('success', true, 'deleted_count', v_count);
END;
$function$;

-- Revoke direct execute
REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_product(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_ended_products(text, int) FROM PUBLIC, anon, authenticated;
