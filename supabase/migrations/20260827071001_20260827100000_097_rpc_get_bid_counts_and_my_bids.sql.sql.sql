/*
# Fix: RPCs to read bids on active auctions

## Problem
The `bids` table RLS policy only allows reading bids on **ended** products.
The app uses custom session auth (not Supabase Auth), so `auth.uid()` is null
and ownership-based policies cannot work. Direct `supabase.from('bids')` queries
return nothing for active products, causing:
- Bid hall shows 0 bidders for active auctions
- Product page can't confirm the user's own bid on active auctions
- Profile "出價紀錄" tab shows no records for active auctions

## Fix
Two new SECURITY DEFINER RPCs that bypass RLS safely:

1. `rpc_get_bid_counts()` — returns `{ product_id, count }` for all active products.
   Callable by anon + authenticated (public data: counts only, no bidder info).

2. `rpc_get_my_bids(p_token TEXT)` — returns the caller's own bids with product info,
   validated via session token. Replaces the direct `supabase.from('bids')` query
   in profile.tsx and product/[id].tsx.

3. `rpc_get_my_bid_for_product(p_token TEXT, p_product_id UUID)` — returns the
   caller's bid for a single product (used on the product detail page).

## Security
- All three functions are SECURITY DEFINER with `search_path = public`.
- `rpc_get_bid_counts` exposes only aggregate counts — no bidder identities.
- `rpc_get_my_bids` and `rpc_get_my_bid_for_product` authenticate via session token
  and only return rows where `bidder_id` matches the session user.
- EXECUTE revoked from anon/authenticated on the token-gated functions; access is
  through the rpc-proxy edge function only.
*/

-- 1. Bid counts for active products (public, no bidder info)
CREATE OR REPLACE FUNCTION public.rpc_get_bid_counts()
RETURNS TABLE (product_id UUID, count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT b.product_id, COUNT(*)::BIGINT AS count
  FROM bids b
  JOIN products p ON p.id = b.product_id
  WHERE p.status = 'active'
  GROUP BY b.product_id;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_bid_counts() TO anon, authenticated;

-- 2. My bids with product info (session-authenticated)
CREATE OR REPLACE FUNCTION public.rpc_get_my_bids(p_token TEXT)
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
        'id', b.id,
        'product_id', b.product_id,
        'bidder_id', b.bidder_id,
        'amount', b.amount,
        'created_at', b.created_at,
        'product', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'status', p.status,
          'end_time', p.end_time,
          'winner_id', p.winner_id,
          'winning_amount', p.winning_amount,
          'image_url', p.image_url
        )
      )
    )
    FROM bids b
    JOIN products p ON p.id = b.product_id
    WHERE b.bidder_id = v_user_id
    ORDER BY b.created_at DESC),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_my_bids(TEXT) FROM PUBLIC, anon, authenticated;

-- 3. My bid for a single product (session-authenticated)
CREATE OR REPLACE FUNCTION public.rpc_get_my_bid_for_product(p_token TEXT, p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_bid JSONB;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT jsonb_build_object(
    'id', b.id,
    'product_id', b.product_id,
    'bidder_id', b.bidder_id,
    'amount', b.amount,
    'created_at', b.created_at
  )
  INTO v_bid
  FROM bids b
  WHERE b.product_id = p_product_id AND b.bidder_id = v_user_id;

  RETURN COALESCE(v_bid, 'null'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_my_bid_for_product(TEXT, UUID) FROM PUBLIC, anon, authenticated;
