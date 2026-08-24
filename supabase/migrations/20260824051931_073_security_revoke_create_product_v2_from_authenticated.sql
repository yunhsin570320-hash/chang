/*
  # F25 — The listing creation function is no longer callable straight from the REST API

  One overload of `rpc_seller_create_product_v2` had EXECUTE granted to `authenticated`,
  letting a holder of a Supabase Auth token call it directly and skip the RPC proxy's
  allowlist and rate limiting. The app calls it through the proxy with the service role.
*/

REVOKE EXECUTE ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamptz, numeric, boolean, numeric, integer, numeric
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamptz, numeric, boolean, numeric, integer, numeric
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamptz, numeric, boolean, numeric, integer, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamptz, numeric, boolean, numeric, integer, numeric
) TO service_role;
