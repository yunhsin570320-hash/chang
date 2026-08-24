/*
# Site Settings — Admin-configurable payment instructions

## Overview
Adds a `site_settings` table so the admin can configure payment instructions
(bank name, account number, account holder) from the admin panel instead of
hard-coding them in the app. The settings are public-readable so all users
see the latest payment info in the membership upgrade modal.

## New Tables
- `site_settings`
  - `key` (text PK): setting key, e.g. 'payment_bank_name', 'payment_account', 'payment_holder', 'payment_instructions'
  - `value` (text): the value
  - `updated_by` (uuid FK → profiles): admin who last updated
  - `updated_at` (timestamptz)

## New RPCs
- `rpc_get_site_settings` — any authenticated user can read all settings
- `rpc_admin_update_site_setting` — admin only, upsert a key-value pair

## Security
- RLS: SELECT for authenticated (and anon so pre-login pages work), UPDATE/INSERT/DELETE admin only
- RPCs revoke direct execute from anon/authenticated (accessed via rpc-proxy)
*/

CREATE TABLE IF NOT EXISTS site_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read settings (payment instructions are public)
DROP POLICY IF EXISTS "site_settings_select_all" ON site_settings;
CREATE POLICY "site_settings_select_all"
ON site_settings FOR SELECT
TO anon, authenticated
USING (true);

-- Only admins can insert
DROP POLICY IF EXISTS "site_settings_insert_admin" ON site_settings;
CREATE POLICY "site_settings_insert_admin"
ON site_settings FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Only admins can update
DROP POLICY IF EXISTS "site_settings_update_admin" ON site_settings;
CREATE POLICY "site_settings_update_admin"
ON site_settings FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Only admins can delete
DROP POLICY IF EXISTS "site_settings_delete_admin" ON site_settings;
CREATE POLICY "site_settings_delete_admin"
ON site_settings FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- ============================================================
-- RPC: Get all site settings (public, returns key→value map)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_site_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  INTO v_result
  FROM site_settings;

  RETURN jsonb_build_object('success', true, 'settings', v_result);
END;
$function$;

-- ============================================================
-- RPC: Admin update a site setting (upsert)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_update_site_setting(
  p_token text,
  p_key text,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_admin    profiles%ROWTYPE;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_admin FROM profiles WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  IF p_key IS NULL OR trim(p_key) = '' THEN
    RETURN jsonb_build_object('error', '設定名稱不可為空');
  END IF;

  INSERT INTO site_settings (key, value, updated_by, updated_at)
  VALUES (trim(p_key), p_value, v_admin_id, now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Revoke direct execute
REVOKE EXECUTE ON FUNCTION public.rpc_get_site_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_site_setting(text, text, text) FROM PUBLIC, anon, authenticated;

-- Seed default values
INSERT INTO site_settings (key, value) VALUES
  ('payment_bank_name', 'XX 銀行 (代碼 000)'),
  ('payment_account', '000-0000-0000'),
  ('payment_holder', 'OOO'),
  ('payment_instructions', '1. 銀行匯款 / 轉帳至以下帳戶
2. 或至超商使用代碼繳費
3. 繳費後請拍攝 / 截圖付款證明
4. 上傳證明並送出，等候管理員審核')
ON CONFLICT (key) DO NOTHING;
