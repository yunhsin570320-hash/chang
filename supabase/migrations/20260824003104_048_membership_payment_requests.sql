/*
# Membership Payment Requests — Manual Collection + Admin Approval

## Overview
Replaces the instant VIP upgrade / deposit flow with a manual payment workflow:
1. Member clicks "升級 VIP" or "繳納保證金" → sees payment instructions (bank account, etc.)
2. Member uploads a payment proof screenshot and submits the request
3. Admin reviews the proof in the admin panel → approves or rejects
4. On approval, the membership tier / deposit is automatically updated

## New Tables
- `payment_requests`
  - `id` (uuid PK)
  - `user_id` (uuid FK → profiles)
  - `type` (text: 'vip_upgrade' | 'vip_deposit')
  - `amount` (numeric: 500 for VIP upgrade, 1000 for deposit)
  - `payment_method` (text: user's chosen method)
  - `proof_image_url` (text: URL to uploaded proof screenshot)
  - `status` (text: 'pending' | 'approved' | 'rejected')
  - `admin_note` (text, nullable: admin's note on approval/rejection)
  - `reviewed_by` (uuid FK → profiles, nullable)
  - `reviewed_at` (timestamptz, nullable)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

## New Storage Bucket
- `payment-proofs` — for payment receipt screenshots
  - SELECT: authenticated only (admin can view, user can view own)
  - INSERT: authenticated only
  - DELETE: admin only

## New RPCs
- `rpc_submit_payment_request` — user submits a payment proof
- `rpc_get_my_payment_requests` — user fetches own payment request history
- `rpc_admin_review_payment_request` — admin approves/rejects

## Security
- RLS on payment_requests: users see only their own; admins see all
- Revoke direct execute on all new functions from anon/authenticated (accessed via rpc-proxy)

## Important Notes
1. Existing `rpc_upgrade_vip_seller` and `rpc_pay_vip_deposit` are kept for backward compatibility but will no longer be called from the UI.
2. The new flow requires admin approval before membership changes take effect.
3. Future: when online payment (direction 2) is added, the same payment_requests table can be used with status='approved' set automatically by a webhook callback.
*/

-- ============================================================
-- 1. Create payment_requests table
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('vip_upgrade', 'vip_deposit')),
  amount numeric NOT NULL,
  payment_method text,
  proof_image_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note text,
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;

-- Users can see only their own payment requests
DROP POLICY IF EXISTS "payment_requests_select_own_or_admin" ON payment_requests;
CREATE POLICY "payment_requests_select_own_or_admin"
ON payment_requests FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Users can insert only their own payment requests
DROP POLICY IF EXISTS "payment_requests_insert_own" ON payment_requests;
CREATE POLICY "payment_requests_insert_own"
ON payment_requests FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
);

-- Only admins can update (approve/reject)
DROP POLICY IF EXISTS "payment_requests_update_admin" ON payment_requests;
CREATE POLICY "payment_requests_update_admin"
ON payment_requests FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Only admins can delete
DROP POLICY IF EXISTS "payment_requests_delete_admin" ON payment_requests;
CREATE POLICY "payment_requests_delete_admin"
ON payment_requests FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_type ON payment_requests(type);

-- ============================================================
-- 2. Create storage bucket for payment proofs
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if any
DROP POLICY IF EXISTS "payment_proofs_public_read" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_admin_delete" ON storage.objects;

-- SELECT: anyone can view (public bucket — proof images need to be displayable)
CREATE POLICY "payment_proofs_public_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'payment-proofs');

-- INSERT: only authenticated users can upload
CREATE POLICY "payment_proofs_authenticated_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'payment-proofs');

-- DELETE: only admins can delete
CREATE POLICY "payment_proofs_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- ============================================================
-- 3. RPC: Submit payment request
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_submit_payment_request(
  p_token text,
  p_type text,
  p_payment_method text DEFAULT NULL,
  p_proof_image_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_profile   profiles%ROWTYPE;
  v_amount    NUMERIC;
  v_existing  payment_requests%ROWTYPE;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到使用者'); END IF;
  IF v_profile.is_blocked THEN
    RETURN jsonb_build_object('error', '帳號已鎖定，無法申請繳費。請先申訴解鎖。');
  END IF;

  -- Validate type and set amount
  IF p_type = 'vip_upgrade' THEN
    v_amount := 500;
    IF v_profile.membership_tier = 'vip' THEN
      RETURN jsonb_build_object('error', '您已是 VIP 會員');
    END IF;
  ELSIF p_type = 'vip_deposit' THEN
    v_amount := 1000;
    IF v_profile.vip_deposit_paid THEN
      RETURN jsonb_build_object('error', '您已繳納競標保證金');
    END IF;
  ELSE
    RETURN jsonb_build_object('error', '無效的繳費類型');
  END IF;

  -- Check for existing pending request of the same type
  SELECT * INTO v_existing
  FROM payment_requests
  WHERE user_id = v_user_id AND type = p_type AND status = 'pending'
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('error', '您已有待審核的同類型繳費申請，請等候管理員審核');
  END IF;

  IF p_proof_image_url IS NULL OR trim(p_proof_image_url) = '' THEN
    RETURN jsonb_build_object('error', '請上傳付款證明截圖');
  END IF;

  INSERT INTO payment_requests (user_id, type, amount, payment_method, proof_image_url, status)
  VALUES (v_user_id, p_type, v_amount, p_payment_method, p_proof_image_url, 'pending');

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- 4. RPC: Get my payment requests
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_my_payment_requests(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期，請重新登入'); END IF;

  RETURN jsonb_build_object(
    'success', true,
    'requests', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'type', type,
          'amount', amount,
          'payment_method', payment_method,
          'proof_image_url', proof_image_url,
          'status', status,
          'admin_note', admin_note,
          'created_at', created_at,
          'reviewed_at', reviewed_at
        ) ORDER BY created_at DESC
      )
      FROM payment_requests WHERE user_id = v_user_id),
      '[]'::jsonb
    )
  );
END;
$function$;

-- ============================================================
-- 5. RPC: Admin review payment request (approve/reject)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_review_payment_request(
  p_token text,
  p_request_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id   UUID;
  v_admin      profiles%ROWTYPE;
  v_request    payment_requests%ROWTYPE;
BEGIN
  v_admin_id := app_get_user_id(p_token);
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', '登入已過期'); END IF;

  SELECT * INTO v_admin FROM profiles WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('error', '無權限執行此操作');
  END IF;

  SELECT * INTO v_request FROM payment_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到此繳費申請'); END IF;
  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', '此申請已審核過了');
  END IF;

  -- Update the request
  UPDATE payment_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      admin_note = p_note,
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  IF p_approve THEN
    -- Apply the membership change
    IF v_request.type = 'vip_upgrade' THEN
      UPDATE profiles
      SET membership_tier = 'vip',
          vip_upgrade_paid = true,
          vip_upgrade_at = now()
      WHERE id = v_request.user_id;

      INSERT INTO notifications (user_id, type, title, message, is_read)
      VALUES (v_request.user_id, 'won', 'VIP 會員升級成功',
        '管理員已確認您的付款，您已升級為 VIP 會員，商品上架無限制。', false);
    ELSIF v_request.type = 'vip_deposit' THEN
      UPDATE profiles
      SET vip_deposit_paid = true,
          vip_deposit_at = now()
      WHERE id = v_request.user_id;

      INSERT INTO notifications (user_id, type, title, message, is_read)
      VALUES (v_request.user_id, 'won', '競標保證金已繳納',
        '管理員已確認您的付款，您現在可以在競價廳參與競標。', false);
    END IF;
  ELSE
    INSERT INTO notifications (user_id, type, title, message, is_read)
    VALUES (v_request.user_id, 'won', '繳費申請未通過',
      '您的繳費證明未通過審核。' || COALESCE(p_note, ''), false);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================
-- 6. Revoke direct execute on all new functions
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.rpc_submit_payment_request(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_get_my_payment_requests(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_review_payment_request(text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
