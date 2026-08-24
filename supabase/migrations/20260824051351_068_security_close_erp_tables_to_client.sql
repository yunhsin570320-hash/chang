/*
  # F14 — Manufacturing and inventory data is no longer readable from the client

  Every ERP table carried policies granted `TO anon, authenticated` with `USING (true)`
  and `WITH CHECK (true)`. Table grants happened to limit the live exposure to SELECT by
  the `authenticated` role, but that still published product recipes, raw material
  costs, suppliers, stock levels and shipments to anyone able to obtain a Supabase Auth
  token with the public anon key.

  All ERP access goes through the `rpc_erp_*` functions, which are executable only by
  the service role and authorise the caller with `erp_auth(p_token, p_min_role)`. Those
  run as SECURITY DEFINER and bypass RLS, so removing the client-facing policies and
  grants does not affect the ERP application. No frontend file references these tables.
*/

DROP POLICY IF EXISTS "ep_select" ON public.erp_products;
DROP POLICY IF EXISTS "ep_insert" ON public.erp_products;
DROP POLICY IF EXISTS "ep_update" ON public.erp_products;

DROP POLICY IF EXISTS "es_select" ON public.erp_shipments;
DROP POLICY IF EXISTS "es_insert" ON public.erp_shipments;

DROP POLICY IF EXISTS "mt_select" ON public.material_transactions;
DROP POLICY IF EXISTS "mt_insert" ON public.material_transactions;

DROP POLICY IF EXISTS "pf_select" ON public.product_formulas;
DROP POLICY IF EXISTS "pf_insert" ON public.product_formulas;
DROP POLICY IF EXISTS "pf_update" ON public.product_formulas;
DROP POLICY IF EXISTS "pf_delete" ON public.product_formulas;

DROP POLICY IF EXISTS "pc_select" ON public.production_consumption;
DROP POLICY IF EXISTS "pc_insert" ON public.production_consumption;
DROP POLICY IF EXISTS "pc_update" ON public.production_consumption;

DROP POLICY IF EXISTS "po_select" ON public.production_orders;
DROP POLICY IF EXISTS "po_insert" ON public.production_orders;
DROP POLICY IF EXISTS "po_update" ON public.production_orders;

DROP POLICY IF EXISTS "pa_select" ON public.purchase_alerts;
DROP POLICY IF EXISTS "pa_insert" ON public.purchase_alerts;
DROP POLICY IF EXISTS "pa_update" ON public.purchase_alerts;

DROP POLICY IF EXISTS "rm_select" ON public.raw_materials;
DROP POLICY IF EXISTS "rm_insert" ON public.raw_materials;
DROP POLICY IF EXISTS "rm_update" ON public.raw_materials;

REVOKE ALL ON public.erp_products FROM anon, authenticated;
REVOKE ALL ON public.erp_shipments FROM anon, authenticated;
REVOKE ALL ON public.material_transactions FROM anon, authenticated;
REVOKE ALL ON public.product_formulas FROM anon, authenticated;
REVOKE ALL ON public.production_consumption FROM anon, authenticated;
REVOKE ALL ON public.production_orders FROM anon, authenticated;
REVOKE ALL ON public.purchase_alerts FROM anon, authenticated;
REVOKE ALL ON public.raw_materials FROM anon, authenticated;
