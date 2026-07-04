-- Remove password_hash column from anon/authenticated direct SELECT access.
-- This is the critical security fix: no client-side code should ever receive password hashes.
-- The service_role (used by rpc-proxy edge function) retains full access.
-- bank_account is kept for own-profile display; only password_hash is removed.

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id, name, role, email, is_buyer, is_seller, is_admin,
  is_blocked, blocked_reason, blocked_at, warning_count,
  phone, phone_verified, phone_verified_at,
  payment_method, bank_account, shipping_address, created_at
) ON public.profiles TO anon, authenticated;
