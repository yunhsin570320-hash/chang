/*
# Display Inflation Settings

## Purpose
Admin can inflate the member count and online count shown to users, to make
the platform look more active during early growth. The real numbers stay
correct in the admin dashboard; only the public-facing rpc_get_member_stats
adds the inflation offsets.

## Settings (stored in site_settings)
- display_total_users_offset  (int, default 0)
- display_online_count_offset (int, default 0)

## Security
- Reuses existing site_settings table + rpc_admin_update_site_setting RPC.
- No new tables, no new RPCs — just new seed rows + updated rpc_get_member_stats.
*/

-- Seed defaults (0 = no inflation)
INSERT INTO site_settings (key, value) VALUES
  ('display_total_users_offset', '0'),
  ('display_online_count_offset', '0')
ON CONFLICT (key) DO NOTHING;

-- Update the public stats RPC to add inflation offsets
CREATE OR REPLACE FUNCTION public.rpc_get_member_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_users      int;
  v_online_count     int;
  v_paid_members     int;
  v_lifetime_members int;
  v_total_offset     int := 0;
  v_online_offset    int := 0;
BEGIN
  SELECT count(*) INTO v_total_users FROM profiles WHERE is_admin IS NOT TRUE;
  SELECT count(*) INTO v_online_count FROM profiles WHERE last_seen_at > now() - interval '5 minutes' AND is_admin IS NOT TRUE;
  SELECT count(*) INTO v_paid_members FROM profiles WHERE membership_tier = 'vip' AND is_admin IS NOT TRUE;
  SELECT count(*) INTO v_lifetime_members FROM profiles WHERE is_lifetime = true AND is_admin IS NOT TRUE;

  -- Read inflation offsets from site_settings
  SELECT COALESCE(value::int, 0) INTO v_total_offset
  FROM site_settings WHERE key = 'display_total_users_offset';
  SELECT COALESCE(value::int, 0) INTO v_online_offset
  FROM site_settings WHERE key = 'display_online_count_offset';

  RETURN jsonb_build_object(
    'success', true,
    'total_users', GREATEST(v_total_users + v_total_offset, v_total_users),
    'online_count', GREATEST(v_online_count + v_online_offset, 0),
    'paid_members', v_paid_members,
    'lifetime_members', v_lifetime_members
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_member_stats() FROM PUBLIC, anon, authenticated;
