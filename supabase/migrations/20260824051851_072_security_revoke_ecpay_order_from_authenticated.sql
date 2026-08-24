/*
  # F24 — The payment order function is no longer callable straight from the REST API

  `rpc_create_ecpay_order` had EXECUTE granted to `authenticated`, so a holder of a
  Supabase Auth token could call /rest/v1/rpc/rpc_create_ecpay_order directly and skip
  the RPC proxy's allowlist, origin check and rate limiting. The app calls it through
  the proxy with the service role, so the grant is unnecessary.
*/

REVOKE EXECUTE ON FUNCTION public.rpc_create_ecpay_order(text, uuid, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_create_ecpay_order(text, uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_create_ecpay_order(text, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_ecpay_order(text, uuid, integer, text) TO service_role;
