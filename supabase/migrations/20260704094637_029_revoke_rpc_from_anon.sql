/*
  # 安全修補 Round 4
  所有 rpc_* 函式的執行權從 anon/authenticated 移除
  — 前端改走 Edge Function (rpc-proxy) 以 service_role 呼叫
  — anon/authenticated 不再需要直接 EXECUTE 權限
*/

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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated', fn);
  END LOOP;
END;
$$;
