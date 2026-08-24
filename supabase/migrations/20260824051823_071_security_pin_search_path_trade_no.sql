/*
  # F23 — Pin the search_path on the order number generator

  `generate_merchant_trade_no` was the only function in the schema without a fixed
  `search_path`, which the database linter flags: a shadowing object on a writable
  schema could change what it resolves to when a SECURITY DEFINER function calls it.
*/

CREATE OR REPLACE FUNCTION public.generate_merchant_trade_no()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path TO 'public'
AS $function$
  SELECT 'EC' || to_char(now(), 'YYYYMMDDHH24MISS') || lpad(floor(random() * 10000)::text, 4, '0');
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_merchant_trade_no() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_merchant_trade_no() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_merchant_trade_no() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_merchant_trade_no() TO service_role;
