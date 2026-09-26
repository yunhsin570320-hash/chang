/*
# Fix: RPC to read delivery data (bypasses RLS for custom auth)

## Problem
The delivery page queries `deliveries`, `products`, and `profiles` directly
from the browser. Since the app uses custom session auth (not Supabase Auth),
`auth.uid()` is null, so:
- `deliveries` SELECT policy (`auth.uid() = winner_id OR auth.uid() = seller_id`)
  returns nothing — the page shows "找不到此交付記錄"
- `profiles` has no SELECT grant at all — buyer info can't load

## Fix
New SECURITY DEFINER RPC `rpc_get_delivery_detail(p_token, p_delivery_id)`:
- Authenticates the user via session token
- Returns delivery + product + buyer info in one call
- Only returns data if the caller is the buyer (winner_id) or seller (seller_id)
- Replaces all three direct `supabase.from(...)` queries in the delivery page

## Security
- SECURITY DEFINER with search_path = public
- Validates session token via app_get_user_id
- Checks that caller is either the winner or the seller before returning data
- EXECUTE revoked from anon/authenticated; only reachable through rpc-proxy
*/

CREATE OR REPLACE FUNCTION public.rpc_get_delivery_detail(
  p_token TEXT,
  p_delivery_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_delivery JSONB;
  v_product JSONB;
  v_buyer JSONB;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  -- Fetch delivery, check ownership
  SELECT to_jsonb(d) INTO v_delivery
  FROM deliveries d
  WHERE d.id = p_delivery_id
    AND (d.winner_id = v_user_id OR d.seller_id = v_user_id);

  IF v_delivery IS NULL THEN
    RETURN jsonb_build_object('error', '找不到此交付記錄');
  END IF;

  -- Fetch product
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'image_url', p.image_url,
    'seller_id', p.seller_id,
    'end_time', p.end_time,
    'status', p.status,
    'winner_id', p.winner_id,
    'winning_amount', p.winning_amount,
    'is_direct_buy', p.is_direct_buy,
    'direct_price', p.direct_price,
    'stock_quantity', p.stock_quantity,
    'shipping_fee', p.shipping_fee
  ) INTO v_product
  FROM products p
  WHERE p.id = (v_delivery ->> 'product_id')::uuid;

  -- Fetch buyer (winner) profile — limited fields
  SELECT jsonb_build_object(
    'id', pr.id,
    'name', pr.name,
    'email', pr.email,
    'phone', pr.phone,
    'payment_method', pr.payment_method,
    'bank_account', pr.bank_account,
    'shipping_address', pr.shipping_address
  ) INTO v_buyer
  FROM profiles pr
  WHERE pr.id = (v_delivery ->> 'winner_id')::uuid;

  RETURN jsonb_build_object(
    'delivery', v_delivery,
    'product', v_product,
    'buyer', v_buyer
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_delivery_detail(TEXT, UUID) FROM PUBLIC, anon, authenticated;
