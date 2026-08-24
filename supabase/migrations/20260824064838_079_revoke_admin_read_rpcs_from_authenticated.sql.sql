-- Revoke direct execute on admin read RPCs from authenticated role.
-- These are only meant to be called through the rpc-proxy edge function
-- (service role). They have internal admin checks, but defense in depth
-- means non-admins should not be able to call them directly at all.

REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_action_log(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_complaints(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_dashboard(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_members(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_payment_requests(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_reports(text) FROM authenticated, anon;
