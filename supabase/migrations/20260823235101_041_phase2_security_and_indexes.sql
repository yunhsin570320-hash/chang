-- ============================================================
-- Phase 2: Security Hardening + Performance Indexes
-- ============================================================

-- 1. REVOKE EXECUTE on ALL SECURITY DEFINER functions from anon & authenticated
--    Uses dynamic SQL to cover all functions regardless of argument signatures

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s(%s) FROM anon, authenticated',
        r.proname, r.args);
    EXCEPTION WHEN OTHERS THEN
      -- Skip if revoke fails (already revoked or no grant)
      NULL;
    END;
  END LOOP;
END $$;

-- 2. Fix function_search_path_mutable on erp_role_level
CREATE OR REPLACE FUNCTION public.erp_role_level(p_role text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_role = 'admin' THEN 100
    WHEN p_role = 'manager' THEN 50
    WHEN p_role = 'staff' THEN 10
    ELSE 0
  END;
$function$;

-- 3. Fix admin_actions RLS — restrict to authenticated only
DROP POLICY IF EXISTS "Anyone can read admin actions" ON admin_actions;
CREATE POLICY "authenticated_can_read_admin_actions"
ON admin_actions FOR SELECT
TO authenticated
USING (true);

-- 4. Fix notifications RLS — only owner can read
DROP POLICY IF EXISTS "Anyone can read notifications" ON notifications;
CREATE POLICY "owner_can_read_notifications"
ON notifications FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 5. Fix reports RLS — only admin and reporter can read
DROP POLICY IF EXISTS "Anyone can read reports" ON reports;
CREATE POLICY "admin_or_reporter_can_read_reports"
ON reports FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  OR reporter_id = auth.uid()
);

-- 6. Fix bids RLS — remove "Public can view bids" (too permissive)
DROP POLICY IF EXISTS "Public can view bids" ON bids;

-- 7. Lock down ERP tables — internal management, not for anon
REVOKE ALL ON public.erp_products FROM anon;
REVOKE ALL ON public.erp_shipments FROM anon;
REVOKE ALL ON public.material_transactions FROM anon;
REVOKE ALL ON public.product_formulas FROM anon;
REVOKE ALL ON public.production_consumption FROM anon;
REVOKE ALL ON public.production_orders FROM anon;
REVOKE ALL ON public.purchase_alerts FROM anon;
REVOKE ALL ON public.raw_materials FROM anon;

-- Authenticated gets SELECT only; writes go through SECURITY DEFINER RPCs
GRANT SELECT ON public.erp_products TO authenticated;
GRANT SELECT ON public.erp_shipments TO authenticated;
GRANT SELECT ON public.material_transactions TO authenticated;
GRANT SELECT ON public.product_formulas TO authenticated;
GRANT SELECT ON public.production_consumption TO authenticated;
GRANT SELECT ON public.production_orders TO authenticated;
GRANT SELECT ON public.purchase_alerts TO authenticated;
GRANT SELECT ON public.raw_materials TO authenticated;

REVOKE UPDATE, DELETE, INSERT ON public.erp_products FROM authenticated;
REVOKE UPDATE, DELETE, INSERT ON public.erp_shipments FROM authenticated;
REVOKE UPDATE, DELETE, INSERT ON public.material_transactions FROM authenticated;
REVOKE UPDATE, DELETE, INSERT ON public.product_formulas FROM authenticated;
REVOKE UPDATE, DELETE, INSERT ON public.production_consumption FROM authenticated;
REVOKE UPDATE, DELETE, INSERT ON public.production_orders FROM authenticated;
REVOKE UPDATE, DELETE, INSERT ON public.purchase_alerts FROM authenticated;
REVOKE UPDATE, DELETE, INSERT ON public.raw_materials FROM authenticated;

-- 8. Fix profiles RLS — restrict sensitive columns from anon
DROP POLICY IF EXISTS "Public can view profiles" ON profiles;
CREATE POLICY "authenticated_can_view_basic_profiles"
ON profiles FOR SELECT
TO authenticated
USING (true);

-- Revoke access to sensitive columns from anon
REVOKE SELECT (password_hash, phone, shipping_address, bank_account, payment_method, blocked_reason, blocked_at) ON profiles FROM anon;

-- 9. Performance indexes for unindexed foreign keys
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_product_id ON admin_actions (product_id);
CREATE INDEX IF NOT EXISTS idx_erp_shipments_operator_id ON erp_shipments (operator_id);
CREATE INDEX IF NOT EXISTS idx_erp_shipments_product_id ON erp_shipments (product_id);
CREATE INDEX IF NOT EXISTS idx_material_transactions_operator_id ON material_transactions (operator_id);
CREATE INDEX IF NOT EXISTS idx_notifications_product_id ON notifications (product_id);
CREATE INDEX IF NOT EXISTS idx_product_formulas_material_id ON product_formulas (material_id);
CREATE INDEX IF NOT EXISTS idx_production_consumption_material_id ON production_consumption (material_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_created_by ON production_orders (created_by);
CREATE INDEX IF NOT EXISTS idx_production_orders_operator_id ON production_orders (operator_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_product_id ON production_orders (product_id);
CREATE INDEX IF NOT EXISTS idx_products_winner_id ON products (winner_id);
CREATE INDEX IF NOT EXISTS idx_purchase_alerts_material_id ON purchase_alerts (material_id);
CREATE INDEX IF NOT EXISTS idx_purchase_alerts_resolved_by ON purchase_alerts (resolved_by);
CREATE INDEX IF NOT EXISTS idx_reports_product_id ON reports (product_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_resolved_by ON reports (resolved_by);

-- 10. Drop unused indexes
DROP INDEX IF EXISTS idx_products_status;
DROP INDEX IF EXISTS idx_products_is_archived;
DROP INDEX IF EXISTS idx_products_is_approved_status;
DROP INDEX IF EXISTS idx_deliveries_winner_id;
DROP INDEX IF EXISTS idx_deliveries_seller_id;
DROP INDEX IF EXISTS idx_notifications_user_id_read;
DROP INDEX IF EXISTS idx_notifications_user_id;
DROP INDEX IF EXISTS idx_notifications_created_at;
DROP INDEX IF EXISTS idx_phone_verifications_user_id;
DROP INDEX IF EXISTS idx_reports_status;
DROP INDEX IF EXISTS idx_reports_reported_user_id;
DROP INDEX IF EXISTS idx_admin_actions_target_user_id;
DROP INDEX IF EXISTS idx_app_sessions_expires_at;
DROP INDEX IF EXISTS idx_material_transactions_material_id;
DROP INDEX IF EXISTS idx_material_transactions_created_at;
DROP INDEX IF EXISTS idx_product_formulas_product_id;
DROP INDEX IF EXISTS idx_production_consumption_order_id;
