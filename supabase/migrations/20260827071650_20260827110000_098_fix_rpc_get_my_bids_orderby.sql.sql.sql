/*
# Fix: ORDER BY inside jsonb_agg in rpc_get_my_bids

## Problem
`rpc_get_my_bids` used `ORDER BY b.created_at DESC` as a standalone clause
inside an aggregate subquery, causing:
  ERROR: column "b.created_at" must appear in the GROUP BY clause
  or be used in an aggregate function

## Fix
Move the ORDER BY inside `jsonb_agg(... ORDER BY b.created_at DESC)`,
which is the correct PostgreSQL syntax for ordering aggregate output.
*/

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
      ORDER BY b.created_at DESC
    )
    FROM bids b
    JOIN products p ON p.id = b.product_id
    WHERE b.bidder_id = v_user_id),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_my_bids(TEXT) FROM PUBLIC, anon, authenticated;
