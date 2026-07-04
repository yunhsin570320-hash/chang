/*
  # 安全修補 Round 3
  1. app_get_user_id / app_is_admin — REVOKE FROM PUBLIC (消除直接呼叫漏洞)
  2. rpc_file_report — 新增 RPC，移除 reports 開放 INSERT 政策
  3. rpc_* 公開函式 — REVOKE FROM PUBLIC，明確 GRANT 給 anon/authenticated
     (最佳實踐：明確授權優於 PUBLIC 隱性授權)
*/

-- ============================================================
-- 1. 移除 helper 函式的 PUBLIC 執行權（只能由其他函式內部使用）
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.app_get_user_id(TEXT)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_is_admin(UUID)     FROM PUBLIC;

-- ============================================================
-- 2. reports — 改走 RPC，移除開放 INSERT 政策
-- ============================================================

DROP POLICY IF EXISTS "Anyone can insert reports" ON reports;

CREATE OR REPLACE FUNCTION rpc_file_report(
  p_token            TEXT,
  p_reported_user_id UUID,
  p_product_id       UUID,
  p_type             TEXT,
  p_reason           TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

  IF trim(p_reason) = '' OR p_type IS NULL THEN
    RETURN jsonb_build_object('error', 'Missing required fields');
  END IF;

  IF EXISTS (
    SELECT 1 FROM reports
    WHERE reporter_id = v_user_id AND product_id = p_product_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('error', '您已提交過此商品的檢舉，請等待審核');
  END IF;

  INSERT INTO reports (reporter_id, reported_user_id, product_id, type, reason, status)
  VALUES (v_user_id, p_reported_user_id, p_product_id, p_type, trim(p_reason), 'pending');

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 3. 所有公開 RPC — REVOKE FROM PUBLIC，明確 GRANT 給 anon/authenticated
--    注意：anon 必須保有 EXECUTE，否則前端（使用 anon key）無法呼叫
-- ============================================================

DO $$
DECLARE
  fn TEXT;
  fns TEXT[] := ARRAY[
    'rpc_login(text,text,text)',
    'rpc_register(text,text,text,boolean,boolean,text,text)',
    'rpc_validate_session(text)',
    'rpc_logout(text)',
    'rpc_update_profile(text,text,text,text,text,boolean,timestamptz)',
    'rpc_mark_notifications_read(text,boolean,uuid)',
    'rpc_seller_create_product(text,text,text,text,timestamptz,integer,boolean,integer,integer)',
    'rpc_seller_end_auction(text,uuid)',
    'rpc_seller_relist_product(text,uuid,timestamptz)',
    'rpc_seller_delete_product(text,uuid)',
    'rpc_seller_archive_products(text,uuid[])',
    'rpc_seller_create_delivery(text,uuid,uuid,bigint,boolean)',
    'rpc_seller_update_delivery(text,uuid,text,text,text,text,timestamptz)',
    'rpc_admin_action(text,text,text,uuid,text)',
    'rpc_file_report(text,uuid,uuid,text,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%s TO anon, authenticated', fn);
  END LOOP;
END;
$$;
