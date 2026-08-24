/*
# Fix: drop duplicate overload of rpc_seller_create_product_v2

## Problem
Migration 046 created `rpc_seller_create_product_v2` with 9 parameters (no p_shipping_fee).
Migration 056 attempted to add `p_shipping_fee` via `CREATE OR REPLACE FUNCTION`, but
`CREATE OR REPLACE` with a different parameter signature creates a NEW overloaded function
instead of replacing the existing one. This left TWO overloads in the database:
  - 9-param version (old, no shipping_fee)
  - 10-param version (new, with shipping_fee)

When the seller page calls the RPC with p_shipping_fee, PostgREST cannot unambiguously
resolve which overload to invoke, causing the product creation to fail.

## Fix
Drop the old 9-parameter overload, leaving only the 10-parameter version that includes
p_shipping_fee. No data is modified.

## Verification
After this migration, only one version of the function should exist.
*/

DROP FUNCTION IF EXISTS public.rpc_seller_create_product_v2(
  text, text, text, text, timestamp with time zone, numeric, boolean, numeric, integer
) CASCADE;

-- Re-grant and revoke to ensure correct permissions on the remaining overload
REVOKE ALL ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamp with time zone, numeric, boolean, numeric, integer, numeric
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamp with time zone, numeric, boolean, numeric, integer, numeric
) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamp with time zone, numeric, boolean, numeric, integer, numeric
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_seller_create_product_v2(
  text, text, text, text, timestamp with time zone, numeric, boolean, numeric, integer, numeric
) TO service_role;
