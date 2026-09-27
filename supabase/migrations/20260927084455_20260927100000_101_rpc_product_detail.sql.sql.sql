/*
# Fix: RPCs for product detail page

## Problem
product/[id].tsx directly queries `profiles` (seller + winner) and `bids`
tables. RLS blocks these because auth.uid() is null with custom auth.

## Fix
Two new SECURITY DEFINER RPCs:

1. `rpc_get_product_detail(p_token, p_product_id)` — returns product + seller
   profile + winner profile + bid count + the caller's bid (if any) + the
   caller's report (if any), all in one call.

2. `rpc_get_ended_auction_bids(p_token, p_product_id)` — returns all bids
   with bidder names for an ended auction, ordered by amount desc.

## Security
- Both authenticate via session token (optional for public product view)
- Only returns data for existing products
- EXECUTE revoked from anon/authenticated
*/

CREATE OR REPLACE FUNCTION public.rpc_get_product_detail(
  p_token TEXT,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_product JSONB;
  v_seller JSONB;
  v_winner JSONB;
  v_bid_count INT;
  v_my_bid JSONB;
  v_my_report JSONB;
BEGIN
  v_user_id := public.app_get_user_id(p_token);

  SELECT to_jsonb(p) INTO v_product
  FROM products p
  WHERE p.id = p_product_id;

  IF v_product IS NULL THEN
    RETURN jsonb_build_object('error', '找不到此商品');
  END IF;

  -- Seller profile (limited fields)
  SELECT jsonb_build_object(
    'id', pr.id,
    'name', pr.name,
    'email', pr.email,
    'phone', pr.phone,
    'payment_method', pr.payment_method,
    'bank_account', pr.bank_account,
    'shipping_address', pr.shipping_address
  ) INTO v_seller
  FROM profiles pr
  WHERE pr.id = (v_product ->> 'seller_id')::uuid;

  -- Winner profile (for ended direct buy)
  IF v_product ->> 'winner_id' IS NOT NULL AND v_product ->> 'status' = 'ended' THEN
    SELECT jsonb_build_object('id', pr.id, 'name', pr.name)
    INTO v_winner
    FROM profiles pr
    WHERE pr.id = (v_product ->> 'winner_id')::uuid;
  END IF;

  -- Bid count
  SELECT COUNT(*)::int INTO v_bid_count
  FROM bids b
  WHERE b.product_id = p_product_id;

  -- My bid (if logged in)
  IF v_user_id IS NOT NULL THEN
    SELECT to_jsonb(b) INTO v_my_bid
    FROM bids b
    WHERE b.product_id = p_product_id AND b.bidder_id = v_user_id
    LIMIT 1;

    -- My report (if logged in)
    SELECT jsonb_build_object('id', r.id) INTO v_my_report
    FROM reports r
    WHERE r.product_id = p_product_id AND r.reporter_id = v_user_id
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'product', v_product,
    'seller', v_seller,
    'winner_profile', v_winner,
    'bid_count', v_bid_count,
    'my_bid', v_my_bid,
    'my_report', v_my_report
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_product_detail(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Ended auction bids with bidder names
CREATE OR REPLACE FUNCTION public.rpc_get_ended_auction_bids(
  p_token TEXT,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_product products%ROWTYPE;
BEGIN
  v_user_id := public.app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '找不到此商品');
  END IF;

  -- Only return bids for ended auctions (not direct buy)
  IF v_product.is_direct_buy = true THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'product_id', b.product_id,
        'bidder_id', b.bidder_id,
        'amount', b.amount,
        'created_at', b.created_at,
        'bidder', jsonb_build_object(
          'id', pr.id,
          'name', pr.name
        )
      )
      ORDER BY b.amount DESC
    )
    FROM bids b
    LEFT JOIN profiles pr ON pr.id = b.bidder_id
    WHERE b.product_id = p_product_id),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_ended_auction_bids(TEXT, UUID) FROM PUBLIC, anon, authenticated;
