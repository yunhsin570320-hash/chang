/*
# Fix: List RPCs for auction hall, direct buy hall, and seller delivery entry

## Problem
1. index.tsx and direct.tsx use supabase.from('products') with a profiles
   join for seller names. Profiles SELECT was locked down (migration 084),
   so the join fails and product lists don't load.
2. Seller backend handleDelivery only finds auction deliveries
   (is_direct_buy=false). Direct buy deliveries are invisible to sellers.

## Fix
1. rpc_get_auction_products — returns approved non-direct-buy products
   with seller name and bid_count in one call.
2. rpc_get_direct_products — returns approved direct-buy products with
   seller name, winner name, and purchased quantity in one call.
3. rpc_seller_get_delivery_by_product — returns the most recent delivery
   for a product where the caller is the seller, regardless of
   is_direct_buy. Used by seller.tsx to jump to the delivery page.

## Security
- All authenticate via session token (optional for public list views)
- Only return approved products
- EXECUTE revoked from anon/authenticated
*/

-- ============================================================
-- 1. Auction products list (replaces index.tsx direct query)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_auction_products(
  p_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.app_get_user_id(p_token);

  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'status', p.status,
        'end_time', p.end_time,
        'winner_id', p.winner_id,
        'winning_amount', p.winning_amount,
        'seller_id', p.seller_id,
        'created_at', p.created_at,
        'image_url', p.image_url,
        'is_direct_buy', p.is_direct_buy,
        'is_approved', p.is_approved,
        'seller', jsonb_build_object('id', pr.id, 'name', pr.name),
        'bid_count', COALESCE(b.bid_cnt, 0)
      )
      ORDER BY p.created_at DESC
    )
    FROM products p
    LEFT JOIN profiles pr ON pr.id = p.seller_id
    LEFT JOIN (
      SELECT product_id, COUNT(*)::int AS bid_cnt
      FROM bids GROUP BY product_id
    ) b ON b.product_id = p.id
    WHERE p.is_approved = true
      AND (p.is_direct_buy IS FALSE OR p.is_direct_buy IS NULL)),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_auction_products(TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. Direct buy products list (replaces direct.tsx direct query)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_direct_products(
  p_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'status', p.status,
        'direct_price', p.direct_price,
        'stock_quantity', p.stock_quantity,
        'seller_id', p.seller_id,
        'winner_id', p.winner_id,
        'winning_amount', p.winning_amount,
        'created_at', p.created_at,
        'image_url', p.image_url,
        'is_direct_buy', p.is_direct_buy,
        'is_approved', p.is_approved,
        'seller', jsonb_build_object('id', pr.id, 'name', pr.name),
        'winner', CASE WHEN w.id IS NOT NULL THEN jsonb_build_object('id', w.id, 'name', w.name) ELSE NULL END
      )
      ORDER BY p.created_at DESC
    )
    FROM products p
    LEFT JOIN profiles pr ON pr.id = p.seller_id
    LEFT JOIN profiles w ON w.id = p.winner_id
    WHERE p.is_approved = true
      AND p.is_direct_buy = true),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_direct_products(TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. Seller: get delivery by product (covers both auction + direct buy)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_seller_get_delivery_by_product(
  p_token TEXT,
  p_product_id UUID,
  p_is_direct_buy BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_delivery JSONB;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  -- Verify caller is the seller of this product
  PERFORM 1 FROM products
  WHERE id = p_product_id AND seller_id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '無權限');
  END IF;

  -- Return most recent delivery matching the type filter
  SELECT jsonb_build_object(
    'id', d.id,
    'product_id', d.product_id,
    'status', d.status,
    'is_direct_buy', d.is_direct_buy,
    'winner_id', d.winner_id,
    'created_at', d.created_at
  ) INTO v_delivery
  FROM deliveries d
  WHERE d.product_id = p_product_id
    AND d.is_direct_buy = p_is_direct_buy
  ORDER BY d.created_at DESC
  LIMIT 1;

  RETURN COALESCE(v_delivery, jsonb_build_object('found', false));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_seller_get_delivery_by_product(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
