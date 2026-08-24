/*
# Admin Delete Ended Products

## Overview
Allows admin to delete ended (結標) products to keep the database lean.
Supports two modes:
  1. Delete a single ended product by ID
  2. Batch delete all ended products older than N days

## Safety
- Only accessible by admin (verified via session token)
- Only products with status = 'ended' can be deleted
- Active products are never touched
- Related rows (deliveries CASCADE, notifications/reports SET NULL) cleaned automatically
- bids table has no FK to products; we delete bids manually before deleting the product

## Changes
- rpc_admin_delete_product(p_token, p_product_id) — delete single ended product
- rpc_admin_delete_ended_products(p_token, p_older_than_days) — batch delete
*/

-- ============================================================
-- RPC: Admin delete a single ended product
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
  v_admin_id uuid;
  v_product profiles%ROWTYPE;
  v_product_name text;
  v_product_status text;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT is_admin INTO v_admin_id FROM profiles WHERE id = v_admin_id LIMIT 1;
  IF NOT v_admin_id THEN
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
-- RPC: Admin batch delete ended products older than N days
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
  v_admin_id uuid;
  v_count int;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT is_admin INTO v_admin_id FROM profiles WHERE id = v_admin_id LIMIT 1;
  IF NOT v_admin_id THEN
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
      AND auction_end_time < now() - (p_older_than_days || ' days')::interval
  );

  -- Delete the ended products
  WITH deleted AS (
    DELETE FROM products
    WHERE status = 'ended'
      AND auction_end_time < now() - (p_older_than_days || ' days')::interval
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
