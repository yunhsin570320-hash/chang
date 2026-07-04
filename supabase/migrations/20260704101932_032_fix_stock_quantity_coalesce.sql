CREATE OR REPLACE FUNCTION public.rpc_seller_create_product(
  p_token text,
  p_name text,
  p_description text,
  p_image_url text,
  p_end_time timestamp with time zone,
  p_reserve_price integer DEFAULT 0,
  p_is_direct_buy boolean DEFAULT false,
  p_direct_price integer DEFAULT NULL,
  p_stock_quantity integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_product_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

  IF NOT EXISTS(
    SELECT 1 FROM profiles WHERE id = v_user_id AND is_seller = true
      AND (is_blocked IS NULL OR is_blocked = false)
  ) THEN
    RETURN jsonb_build_object('error', 'Not authorized');
  END IF;

  INSERT INTO products (
    name, description, seller_id, end_time, image_url, status, is_approved,
    is_direct_buy, reserve_price, direct_price, stock_quantity
  ) VALUES (
    trim(p_name), trim(p_description), v_user_id, p_end_time, p_image_url,
    'active', true, p_is_direct_buy,
    COALESCE(p_reserve_price, 0),
    p_direct_price,
    COALESCE(p_stock_quantity, 1)
  )
  RETURNING id INTO v_product_id;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;
