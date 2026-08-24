-- Grant SELECT on new profile columns to anon so the admin member list
-- (which reads profiles directly via the anon key) can display membership info.
-- These columns are already exposed to anon via the existing SELECT policy
-- "authenticated_can_view_basic_profiles" which uses USING(true), but the
-- column-level grant was never extended to the new columns.
--
-- last_seen_at is NOT granted here — it's privacy-sensitive (reveals activity
-- patterns). The online count is served through rpc_get_member_stats instead.

GRANT SELECT (membership_tier, membership_number, is_lifetime, vip_upgrade_paid, vip_deposit_paid) 
  ON public.profiles TO anon;

-- Also grant SELECT on phone and blocked_reason which the admin page already 
-- selects but were missing from the anon column-level grant
GRANT SELECT (phone, blocked_reason) 
  ON public.profiles TO anon;