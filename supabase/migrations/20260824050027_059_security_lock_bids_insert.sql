/*
  # F1 — Remove anonymous/direct bid insertion

  The policy `insert_bids_active_only` was granted `TO public`, which includes the
  `anon` role, and its WITH CHECK only verified that the product was active. That
  allowed any caller holding the public anon key to POST directly to /rest/v1/bids
  with an arbitrary `bidder_id` and `amount`, bypassing every rule enforced by
  `rpc_place_bid_v2` (deposit paid, one bid per user, reserve price, no self-bidding).

  Bids are only ever written by `rpc_place_bid_v2` / `rpc_place_bid`, which run as
  SECURITY DEFINER through the service role, so removing the client write path does
  not affect the application.
*/

DROP POLICY IF EXISTS "insert_bids_active_only" ON public.bids;

REVOKE INSERT, UPDATE, DELETE ON public.bids FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.bids FROM authenticated;
