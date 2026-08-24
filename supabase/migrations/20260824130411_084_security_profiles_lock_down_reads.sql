/*
  # Lock down profiles reads (F1)

  The app never uses Supabase Auth: identity is a custom session token and every
  profile read the app needs goes through rpc_validate_session or an admin RPC.
  The policy below granted every holder of an `authenticated` JWT an unfiltered
  read of all member rows, including email, phone, shipping_address and
  bank_account.

  1. Drop the blanket SELECT policy.
  2. Revoke every privilege on profiles from `authenticated`, which has no
     legitimate caller in this application.

  `anon` grants are intentionally left in place: with no policy for that role,
  RLS already denies every row, so existing queries keep returning no rows
  instead of turning into permission errors.
*/

DROP POLICY IF EXISTS "authenticated_can_view_basic_profiles" ON public.profiles;

REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM authenticated;
