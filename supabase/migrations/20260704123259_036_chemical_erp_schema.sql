-- ============================================================
-- Chemical ERP: Core Schema
-- ============================================================

-- 1. Add erp_role to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS erp_role text NOT NULL DEFAULT 'operator'
  CHECK (erp_role IN ('admin', 'manager', 'operator', 'viewer'));

-- Sync existing admins
UPDATE profiles SET erp_role = 'admin' WHERE is_admin = true;

-- 2. Raw Materials master
CREATE TABLE IF NOT EXISTS raw_materials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text UNIQUE NOT NULL,
  name         text NOT NULL,
  unit         text NOT NULL DEFAULT 'kg',
  safety_stock numeric NOT NULL DEFAULT 0,
  current_stock numeric NOT NULL DEFAULT 0,
  supplier     text,
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rm_select" ON raw_materials FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rm_insert" ON raw_materials FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rm_update" ON raw_materials FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- 3. Raw material inventory transactions
CREATE TABLE IF NOT EXISTS material_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES raw_materials(id),
  type        text NOT NULL CHECK (type IN ('receive', 'consume', 'adjust')),
  quantity    numeric NOT NULL,
  reference   text,
  operator_id uuid REFERENCES profiles(id),
  notes       text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE material_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mt_select" ON material_transactions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "mt_insert" ON material_transactions FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 4. Finished products master
CREATE TABLE IF NOT EXISTS erp_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text UNIQUE NOT NULL,
  name                 text NOT NULL,
  unit                 text NOT NULL DEFAULT 'kg',
  specific_gravity     numeric NOT NULL DEFAULT 1.0,
  drum_capacity_liters numeric NOT NULL DEFAULT 200,
  safety_stock         numeric NOT NULL DEFAULT 0,
  current_stock        numeric NOT NULL DEFAULT 0,
  notes                text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);
ALTER TABLE erp_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_select" ON erp_products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ep_insert" ON erp_products FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "ep_update" ON erp_products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- 5. Product formulas (BOM – Bill of Materials)
-- quantity_per_100kg: how many kg of this raw material per 100 kg of finished product
CREATE TABLE IF NOT EXISTS product_formulas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES erp_products(id) ON DELETE CASCADE,
  material_id         uuid NOT NULL REFERENCES raw_materials(id),
  quantity_per_100kg  numeric NOT NULL,
  notes               text,
  UNIQUE(product_id, material_id)
);
ALTER TABLE product_formulas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pf_select" ON product_formulas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "pf_insert" ON product_formulas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "pf_update" ON product_formulas FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pf_delete" ON product_formulas FOR DELETE TO anon, authenticated USING (true);

-- 6. Production orders
CREATE TABLE IF NOT EXISTS production_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     text UNIQUE NOT NULL,
  product_id       uuid NOT NULL REFERENCES erp_products(id),
  planned_quantity numeric NOT NULL,
  actual_quantity  numeric,
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  operator_id      uuid REFERENCES profiles(id),
  started_at       timestamptz,
  completed_at     timestamptz,
  notes            text,
  created_at       timestamptz DEFAULT now(),
  created_by       uuid REFERENCES profiles(id)
);
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po_select" ON production_orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "po_insert" ON production_orders FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "po_update" ON production_orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- 7. Production consumption records (materials used per order)
CREATE TABLE IF NOT EXISTS production_consumption (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  material_id      uuid NOT NULL REFERENCES raw_materials(id),
  planned_quantity numeric NOT NULL,
  actual_quantity  numeric,
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE production_consumption ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pc_select" ON production_consumption FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "pc_insert" ON production_consumption FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "pc_update" ON production_consumption FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- 8. Outbound shipments
CREATE TABLE IF NOT EXISTS erp_shipments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_number  text UNIQUE NOT NULL,
  product_id       uuid NOT NULL REFERENCES erp_products(id),
  quantity_kg      numeric NOT NULL,
  kg_per_drum      numeric,
  drums_count      numeric,
  customer         text NOT NULL,
  destination      text,
  operator_id      uuid REFERENCES profiles(id),
  shipped_at       timestamptz DEFAULT now(),
  notes            text,
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE erp_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "es_select" ON erp_shipments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "es_insert" ON erp_shipments FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 9. Purchase notifications (low-stock alerts)
CREATE TABLE IF NOT EXISTS purchase_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id   uuid NOT NULL REFERENCES raw_materials(id),
  triggered_at  timestamptz DEFAULT now(),
  current_stock numeric NOT NULL,
  safety_stock  numeric NOT NULL,
  is_resolved   boolean DEFAULT false,
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES profiles(id)
);
ALTER TABLE purchase_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa_select" ON purchase_alerts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "pa_insert" ON purchase_alerts FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "pa_update" ON purchase_alerts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_material_transactions_material_id ON material_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_material_transactions_created_at  ON material_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_formulas_product_id       ON product_formulas(product_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_status          ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_production_orders_created_at      ON production_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_consumption_order_id   ON production_consumption(order_id);
CREATE INDEX IF NOT EXISTS idx_erp_shipments_created_at          ON erp_shipments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_alerts_is_resolved       ON purchase_alerts(is_resolved) WHERE is_resolved = false;
