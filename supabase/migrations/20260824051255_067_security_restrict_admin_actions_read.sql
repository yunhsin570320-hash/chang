/*
  # F13 — The admin action log is no longer readable by outside accounts

  `authenticated_can_read_admin_actions` was `FOR SELECT TO authenticated USING (true)`,
  so any holder of a Supabase Auth token could read the entire moderation history,
  including targets and reasons. The role also held INSERT/UPDATE/DELETE grants on the
  audit trail, blocked only by the absence of write policies.

  The app reads this table through `rpc_admin_action`-family functions running as the
  service role, which bypass RLS, so restricting the client policy does not affect it.
*/

DROP POLICY IF EXISTS "authenticated_can_read_admin_actions" ON public.admin_actions;

CREATE POLICY "admins_can_read_admin_actions"
  ON public.admin_actions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.admin_actions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.admin_actions FROM authenticated;
REVOKE SELECT ON public.admin_actions FROM anon;
