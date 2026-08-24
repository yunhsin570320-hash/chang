-- F2: anon and authenticated held INSERT/UPDATE on every column of profiles,
-- including is_admin and membership_tier. All legitimate writes go through
-- SECURITY DEFINER functions (rpc_register, rpc_update_profile, rpc_admin_*),
-- which run as the owner, so the client roles need no write privilege at all.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM authenticated;