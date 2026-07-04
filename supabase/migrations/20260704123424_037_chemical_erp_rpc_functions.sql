-- ============================================================
-- Chemical ERP: RPC Functions
-- ============================================================

-- Role level helper
CREATE OR REPLACE FUNCTION erp_role_level(p_role text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'viewer'   THEN 1
    WHEN 'operator' THEN 2
    WHEN 'manager'  THEN 3
    WHEN 'admin'    THEN 4
    ELSE 0
  END;
$$;

-- Resolve user from token and check minimum role; returns user_id or NULL
CREATE OR REPLACE FUNCTION erp_auth(p_token text, p_min_role text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_role    text;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT CASE WHEN is_admin THEN 'admin' ELSE erp_role END
    INTO v_role FROM profiles WHERE id = v_user_id;
  IF erp_role_level(v_role) >= erp_role_level(p_min_role) THEN
    RETURN v_user_id;
  END IF;
  RETURN NULL;
END;
$$;

-- Helper: trigger purchase alert when stock drops below safety
CREATE OR REPLACE FUNCTION erp_check_safety_stock(p_material_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec raw_materials%ROWTYPE;
BEGIN
  SELECT * INTO v_rec FROM raw_materials WHERE id = p_material_id;
  IF v_rec.current_stock < v_rec.safety_stock THEN
    IF NOT EXISTS (
      SELECT 1 FROM purchase_alerts
      WHERE material_id = p_material_id AND is_resolved = false
    ) THEN
      INSERT INTO purchase_alerts (material_id, current_stock, safety_stock)
      VALUES (p_material_id, v_rec.current_stock, v_rec.safety_stock);
    ELSE
      UPDATE purchase_alerts
        SET current_stock = v_rec.current_stock, triggered_at = now()
      WHERE material_id = p_material_id AND is_resolved = false;
    END IF;
  ELSE
    UPDATE purchase_alerts SET is_resolved = true, resolved_at = now()
    WHERE material_id = p_material_id AND is_resolved = false;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- Update rpc_validate_session to include erp_role
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_validate_session(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', id, 'name', name, 'email', email, 'role', role,
      'erp_role', CASE WHEN is_admin THEN 'admin' ELSE erp_role END,
      'is_buyer', is_buyer, 'is_seller', is_seller, 'is_admin', is_admin,
      'is_blocked', is_blocked, 'blocked_reason', blocked_reason,
      'blocked_at', blocked_at, 'warning_count', warning_count,
      'phone', phone, 'phone_verified', phone_verified,
      'phone_verified_at', phone_verified_at, 'payment_method', payment_method,
      'bank_account', bank_account, 'shipping_address', shipping_address,
      'created_at', created_at
    ) FROM profiles WHERE id = v_user_id
  );
END;
$$;

-- Also update rpc_login to return erp_role
CREATE OR REPLACE FUNCTION rpc_login(
  p_email            TEXT,
  p_password_hash    TEXT,
  p_password_original TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p     profiles%ROWTYPE;
  v_token TEXT;
  v_match BOOLEAN := false;
BEGIN
  SELECT * INTO v_p FROM profiles WHERE email = lower(trim(p_email)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '郵箱或密碼錯誤'); END IF;
  IF v_p.is_blocked THEN
    RETURN jsonb_build_object('error', '此帳號已被停用。原因：' || COALESCE(v_p.blocked_reason, '違反使用規範'));
  END IF;

  IF v_p.password_hash IS NOT NULL AND length(v_p.password_hash) = 64 AND v_p.password_hash ~ '^[0-9a-f]+$' THEN
    v_match := (v_p.password_hash = p_password_hash);
  ELSE
    v_match := (v_p.password_hash = p_password_original);
    IF v_match AND p_password_hash IS NOT NULL AND length(p_password_hash) = 64 THEN
      UPDATE profiles SET password_hash = p_password_hash WHERE id = v_p.id;
    END IF;
  END IF;

  IF NOT v_match THEN RETURN jsonb_build_object('error', '郵箱或密碼錯誤'); END IF;

  DELETE FROM app_sessions WHERE user_id = v_p.id AND expires_at < now();
  INSERT INTO app_sessions (user_id) VALUES (v_p.id) RETURNING token INTO v_token;

  RETURN jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_p.id, 'name', v_p.name, 'email', v_p.email, 'role', v_p.role,
      'erp_role', CASE WHEN v_p.is_admin THEN 'admin' ELSE v_p.erp_role END,
      'is_buyer', v_p.is_buyer, 'is_seller', v_p.is_seller, 'is_admin', v_p.is_admin,
      'is_blocked', v_p.is_blocked, 'blocked_reason', v_p.blocked_reason,
      'blocked_at', v_p.blocked_at, 'warning_count', v_p.warning_count,
      'phone', v_p.phone, 'phone_verified', v_p.phone_verified,
      'phone_verified_at', v_p.phone_verified_at, 'payment_method', v_p.payment_method,
      'bank_account', v_p.bank_account, 'shipping_address', v_p.shipping_address,
      'created_at', v_p.created_at
    )
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- Raw Material RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_erp_create_material(
  p_token    text,
  p_code     text,
  p_name     text,
  p_unit     text DEFAULT 'kg',
  p_safety   numeric DEFAULT 0,
  p_supplier text DEFAULT NULL,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_id  uuid;
BEGIN
  v_uid := erp_auth(p_token, 'manager');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足（需要manager以上）'); END IF;
  IF EXISTS (SELECT 1 FROM raw_materials WHERE code = upper(trim(p_code))) THEN
    RETURN jsonb_build_object('error', '原料編號已存在');
  END IF;
  INSERT INTO raw_materials (code, name, unit, safety_stock, supplier, notes)
  VALUES (upper(trim(p_code)), trim(p_name), trim(p_unit), p_safety, p_supplier, p_notes)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_update_material(
  p_token    text,
  p_id       uuid,
  p_name     text DEFAULT NULL,
  p_unit     text DEFAULT NULL,
  p_safety   numeric DEFAULT NULL,
  p_supplier text DEFAULT NULL,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := erp_auth(p_token, 'manager');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  UPDATE raw_materials SET
    name         = COALESCE(p_name, name),
    unit         = COALESCE(p_unit, unit),
    safety_stock = COALESCE(p_safety, safety_stock),
    supplier     = COALESCE(p_supplier, supplier),
    notes        = COALESCE(p_notes, notes),
    updated_at   = now()
  WHERE id = p_id;
  PERFORM erp_check_safety_stock(p_id);
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_receive_material(
  p_token     text,
  p_id        uuid,
  p_quantity  numeric,
  p_reference text DEFAULT NULL,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid;
  v_new_stock numeric;
BEGIN
  v_uid := erp_auth(p_token, 'operator');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  IF p_quantity <= 0 THEN RETURN jsonb_build_object('error', '數量必須大於0'); END IF;

  INSERT INTO material_transactions (material_id, type, quantity, reference, operator_id, notes)
  VALUES (p_id, 'receive', p_quantity, p_reference, v_uid, p_notes);

  UPDATE raw_materials SET current_stock = current_stock + p_quantity, updated_at = now()
  WHERE id = p_id RETURNING current_stock INTO v_new_stock;

  PERFORM erp_check_safety_stock(p_id);
  RETURN jsonb_build_object('success', true, 'new_stock', v_new_stock);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_adjust_material(
  p_token     text,
  p_id        uuid,
  p_new_stock numeric,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid;
  v_old   numeric;
  v_delta numeric;
BEGIN
  v_uid := erp_auth(p_token, 'manager');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足（需要manager以上）'); END IF;

  SELECT current_stock INTO v_old FROM raw_materials WHERE id = p_id;
  v_delta := p_new_stock - v_old;

  INSERT INTO material_transactions (material_id, type, quantity, operator_id, notes)
  VALUES (p_id, 'adjust', v_delta, v_uid, COALESCE(p_notes, '庫存調整'));

  UPDATE raw_materials SET current_stock = p_new_stock, updated_at = now() WHERE id = p_id;
  PERFORM erp_check_safety_stock(p_id);
  RETURN jsonb_build_object('success', true, 'new_stock', p_new_stock);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- Product RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_erp_create_product(
  p_token          text,
  p_code           text,
  p_name           text,
  p_unit           text DEFAULT 'kg',
  p_specific_gravity numeric DEFAULT 1.0,
  p_drum_liters    numeric DEFAULT 200,
  p_safety         numeric DEFAULT 0,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_id  uuid;
BEGIN
  v_uid := erp_auth(p_token, 'manager');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  IF EXISTS (SELECT 1 FROM erp_products WHERE code = upper(trim(p_code))) THEN
    RETURN jsonb_build_object('error', '產品編號已存在');
  END IF;
  INSERT INTO erp_products (code, name, unit, specific_gravity, drum_capacity_liters, safety_stock, notes)
  VALUES (upper(trim(p_code)), trim(p_name), trim(p_unit), p_specific_gravity, p_drum_liters, p_safety, p_notes)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_update_product(
  p_token          text,
  p_id             uuid,
  p_name           text DEFAULT NULL,
  p_specific_gravity numeric DEFAULT NULL,
  p_drum_liters    numeric DEFAULT NULL,
  p_safety         numeric DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := erp_auth(p_token, 'manager');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  UPDATE erp_products SET
    name                 = COALESCE(p_name, name),
    specific_gravity     = COALESCE(p_specific_gravity, specific_gravity),
    drum_capacity_liters = COALESCE(p_drum_liters, drum_capacity_liters),
    safety_stock         = COALESCE(p_safety, safety_stock),
    notes                = COALESCE(p_notes, notes),
    updated_at           = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_upsert_formula_item(
  p_token        text,
  p_product_id   uuid,
  p_material_id  uuid,
  p_qty_per_100  numeric,
  p_notes        text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := erp_auth(p_token, 'manager');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  INSERT INTO product_formulas (product_id, material_id, quantity_per_100kg, notes)
  VALUES (p_product_id, p_material_id, p_qty_per_100, p_notes)
  ON CONFLICT (product_id, material_id)
  DO UPDATE SET quantity_per_100kg = EXCLUDED.quantity_per_100kg, notes = EXCLUDED.notes;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_delete_formula_item(
  p_token       text,
  p_formula_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := erp_auth(p_token, 'manager');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  DELETE FROM product_formulas WHERE id = p_formula_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- Production RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_erp_create_production_order(
  p_token    text,
  p_product_id uuid,
  p_quantity numeric,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid;
  v_order_id uuid;
  v_number  text;
BEGIN
  v_uid := erp_auth(p_token, 'operator');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  IF p_quantity <= 0 THEN RETURN jsonb_build_object('error', '生產數量必須大於0'); END IF;

  v_number := 'PO-' || to_char(now(), 'YYYYMMDD') || '-' ||
              lpad((COALESCE((SELECT count(*) FROM production_orders WHERE order_number LIKE 'PO-' || to_char(now(), 'YYYYMMDD') || '%'), 0) + 1)::text, 3, '0');

  INSERT INTO production_orders (order_number, product_id, planned_quantity, notes, created_by)
  VALUES (v_number, p_product_id, p_quantity, p_notes, v_uid)
  RETURNING id INTO v_order_id;

  -- Pre-calculate consumption plan from formula
  INSERT INTO production_consumption (order_id, material_id, planned_quantity)
  SELECT v_order_id, pf.material_id,
         ROUND((pf.quantity_per_100kg / 100.0) * p_quantity, 3)
  FROM product_formulas pf
  WHERE pf.product_id = p_product_id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_number);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_start_production(
  p_token    text,
  p_order_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid;
  v_order production_orders%ROWTYPE;
  v_rec   RECORD;
  v_avail numeric;
BEGIN
  v_uid := erp_auth(p_token, 'operator');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;

  SELECT * INTO v_order FROM production_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '生產單不存在'); END IF;
  IF v_order.status != 'pending' THEN RETURN jsonb_build_object('error', '生產單狀態不正確'); END IF;

  -- Check material availability
  FOR v_rec IN
    SELECT pc.material_id, pc.planned_quantity, rm.name, rm.current_stock, rm.unit
    FROM production_consumption pc
    JOIN raw_materials rm ON rm.id = pc.material_id
    WHERE pc.order_id = p_order_id
  LOOP
    IF v_rec.current_stock < v_rec.planned_quantity THEN
      RETURN jsonb_build_object(
        'error', '原料庫存不足：' || v_rec.name ||
                 '（需要 ' || v_rec.planned_quantity || ' ' || v_rec.unit ||
                 '，現有 ' || v_rec.current_stock || ' ' || v_rec.unit || '）'
      );
    END IF;
  END LOOP;

  UPDATE production_orders
  SET status = 'in_progress', operator_id = v_uid, started_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_complete_production(
  p_token          text,
  p_order_id       uuid,
  p_actual_quantity numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid;
  v_order   production_orders%ROWTYPE;
  v_ratio   numeric;
  v_rec     RECORD;
  v_actual_used numeric;
BEGIN
  v_uid := erp_auth(p_token, 'operator');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;

  SELECT * INTO v_order FROM production_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '生產單不存在'); END IF;
  IF v_order.status != 'in_progress' THEN RETURN jsonb_build_object('error', '生產單狀態不正確'); END IF;

  v_ratio := p_actual_quantity / v_order.planned_quantity;

  -- Deduct materials proportionally to actual production
  FOR v_rec IN
    SELECT id, material_id, planned_quantity FROM production_consumption WHERE order_id = p_order_id
  LOOP
    v_actual_used := ROUND(v_rec.planned_quantity * v_ratio, 3);
    UPDATE production_consumption SET actual_quantity = v_actual_used WHERE id = v_rec.id;
    UPDATE raw_materials SET current_stock = current_stock - v_actual_used, updated_at = now()
    WHERE id = v_rec.material_id;
    PERFORM erp_check_safety_stock(v_rec.material_id);

    INSERT INTO material_transactions (material_id, type, quantity, reference, operator_id, notes)
    VALUES (v_rec.material_id, 'consume', -v_actual_used, v_order.order_number, v_uid,
            '生產用料：' || v_order.order_number);
  END LOOP;

  -- Add finished goods to product stock
  UPDATE erp_products SET current_stock = current_stock + p_actual_quantity, updated_at = now()
  WHERE id = v_order.product_id;

  UPDATE production_orders
  SET status = 'completed', actual_quantity = p_actual_quantity, completed_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- Shipment RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_erp_create_shipment(
  p_token       text,
  p_product_id  uuid,
  p_quantity_kg numeric,
  p_customer    text,
  p_destination text DEFAULT NULL,
  p_notes       text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        uuid;
  v_product    erp_products%ROWTYPE;
  v_ship_id    uuid;
  v_number     text;
  v_kg_per_drum numeric;
  v_drums      numeric;
BEGIN
  v_uid := erp_auth(p_token, 'operator');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;

  SELECT * INTO v_product FROM erp_products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '產品不存在'); END IF;
  IF v_product.current_stock < p_quantity_kg THEN
    RETURN jsonb_build_object(
      'error', '成品庫存不足（需要 ' || p_quantity_kg || ' kg，現有 ' || v_product.current_stock || ' kg）'
    );
  END IF;

  v_kg_per_drum := v_product.specific_gravity * v_product.drum_capacity_liters;
  v_drums       := CEIL(p_quantity_kg / v_kg_per_drum);

  v_number := 'SH-' || to_char(now(), 'YYYYMMDD') || '-' ||
              lpad((COALESCE((SELECT count(*) FROM erp_shipments WHERE shipment_number LIKE 'SH-' || to_char(now(), 'YYYYMMDD') || '%'), 0) + 1)::text, 3, '0');

  INSERT INTO erp_shipments (shipment_number, product_id, quantity_kg, kg_per_drum, drums_count,
                              customer, destination, operator_id, notes)
  VALUES (v_number, p_product_id, p_quantity_kg, v_kg_per_drum, v_drums,
          trim(p_customer), p_destination, v_uid, p_notes)
  RETURNING id INTO v_ship_id;

  UPDATE erp_products SET current_stock = current_stock - p_quantity_kg, updated_at = now()
  WHERE id = p_product_id;

  RETURN jsonb_build_object('success', true, 'shipment_id', v_ship_id,
                            'shipment_number', v_number,
                            'kg_per_drum', v_kg_per_drum, 'drums_count', v_drums);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- Alert / Admin RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_erp_resolve_alert(
  p_token    text,
  p_alert_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := erp_auth(p_token, 'operator');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  UPDATE purchase_alerts SET is_resolved = true, resolved_at = now(), resolved_by = v_uid
  WHERE id = p_alert_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_update_role(
  p_token    text,
  p_user_id  uuid,
  p_erp_role text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := erp_auth(p_token, 'admin');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足（需要admin）'); END IF;
  IF p_erp_role NOT IN ('admin', 'manager', 'operator', 'viewer') THEN
    RETURN jsonb_build_object('error', '無效的角色值');
  END IF;
  UPDATE profiles SET erp_role = p_erp_role WHERE id = p_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_erp_create_user(
  p_token         text,
  p_name          text,
  p_email         text,
  p_password_hash text,
  p_erp_role      text DEFAULT 'operator'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid;
  v_new_id uuid;
BEGIN
  v_uid := erp_auth(p_token, 'admin');
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', '權限不足'); END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE email = lower(trim(p_email))) THEN
    RETURN jsonb_build_object('error', '此郵箱已被使用');
  END IF;
  INSERT INTO profiles (name, email, password_hash, erp_role, role, is_buyer, is_seller)
  VALUES (trim(p_name), lower(trim(p_email)), p_password_hash, p_erp_role, 'buyer', false, false)
  RETURNING id INTO v_new_id;
  RETURN jsonb_build_object('success', true, 'user_id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION erp_auth(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_create_material(text, text, text, text, numeric, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_update_material(text, uuid, text, text, numeric, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_receive_material(text, uuid, numeric, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_adjust_material(text, uuid, numeric, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_create_product(text, text, text, text, numeric, numeric, numeric, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_update_product(text, uuid, text, numeric, numeric, numeric, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_upsert_formula_item(text, uuid, uuid, numeric, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_delete_formula_item(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_create_production_order(text, uuid, numeric, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_start_production(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_complete_production(text, uuid, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_create_shipment(text, uuid, numeric, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_resolve_alert(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_update_role(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_erp_create_user(text, text, text, text, text) TO anon, authenticated;
