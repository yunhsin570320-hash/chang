-- Force revoke EXECUTE from PUBLIC, anon, and authenticated on all SECURITY DEFINER functions
-- The previous dynamic approach didn't work. Using explicit REVOKE FROM PUBLIC.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s(%s) FROM PUBLIC', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s(%s) FROM anon', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s(%s) FROM authenticated', r.proname, r.args);
  END LOOP;
END $$;
