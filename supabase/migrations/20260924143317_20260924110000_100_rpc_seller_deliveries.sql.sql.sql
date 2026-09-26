/*
# Fix: RPC for seller's delivery list and product list

## Problem
seller.tsx directly queries `deliveries`, `profiles`, and `bids` tables.
Since the app uses custom auth, `auth.uid()` is null and RLS blocks all
these queries. The seller page can't see delivery statuses, bid counts,
or winner names.

## Fix
Two new SECURITY DEFINER RPCs:

1. `rpc_get_seller_deliveries(p_token, p_product_ids)` — returns delivery
   rows for the given product IDs, but only if the caller is the seller
   of those products.

2. `rpc_get_seller_product_overview(p_token)` — returns all the seller's
   products with bid counts, winner names, and delivery status in one call,
   replacing the multiple direct queries in fetchProducts().

## Security
- Both authenticate via session token
- Only return data where seller_id = caller's user_id
- EXECUTE revoked from anon/authenticated
*/

CREATE OR REPLACE FUNCTION public.rpc_get_seller_deliveries(
  p_token TEXT,
  p_product_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'product_id', d.product_id,
        'status', d.status,
        'completed_summary', d.completed_summary,
        'completed_at', d.completed_at,
        'created_at', d.created_at,
        'is_direct_buy', d.is_direct_buy,
        'winner_id', d.winner_id
      )
      ORDER BY d.created_at
    )
    FROM deliveries d
    JOIN products p ON p.id = d.product_id
    WHERE p.seller_id = v_user_id
      AND (p_product_ids IS NULL OR d.product_id = ANY(p_product_ids))),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_seller_deliveries(TEXT, UUID[]) FROM PUBLIC, anon, authenticated;

-- Seller product overview: products + bid counts + winner names + delivery status
CREATE OR REPLACE FUNCTION public.rpc_get_seller_product_overview(
  p_token TEXT,
  p_archived BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

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
        'is_archived', p.is_archived,
        'reserve_price', p.reserve_price,
        'is_direct_buy', p.is_direct_buy,
        'direct_price', p.direct_price,
        'stock_quantity', p.stock_quantity,
        'shipping_fee', p.shipping_fee,
        'image_url', p.image_url,
        'bid_count', COALESCE(b.bid_cnt, 0),
        'winner_name', w.name,
        'delivery_status', d.status,
        'delivery_id', d.id,
        'pending_delivery_count', COALESCE(pd.cnt, 0)
      )
      ORDER BY p.created_at DESC
    )
    FROM products p
    LEFT JOIN (
      SELECT product_id, COUNT(*)::int AS bid_cnt
      FROM bids GROUP BY product_id
    ) b ON b.product_id = p.id
    LEFT JOIN profiles w ON w.id = p.winner_id
    LEFT JOIN LATERAL (
      SELECT id, status
      FROM deliveries
      WHERE product_id = p.id AND is_direct_buy = false
      ORDER BY created_at DESC
      LIMIT 1
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM deliveries
      WHERE product_id = p.id
        AND is_direct_buy = true
        AND status IN ('pending', 'shipped', 'delivered')
    ) pd ON true
    WHERE p.seller_id = v_user_id
      AND p.is_archived = p_archived),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_seller_product_overview(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Archived deliveries for seller
CREATE OR REPLACE FUNCTION public.rpc_get_seller_archived_deliveries(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'product_id', d.product_id,
        'completed_summary', d.completed_summary,
        'completed_at', d.completed_at,
        'product_name', p.name
      )
      ORDER BY d.completed_at DESC NULLS LAST
    )
    FROM deliveries d
    JOIN products p ON p.id = d.product_id
    WHERE p.seller_id = v_user_id
      AND d.status = 'completed'
      AND p.is_archived = true),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_seller_archived_deliveries(TEXT) FROM PUBLIC, anon, authenticated;
