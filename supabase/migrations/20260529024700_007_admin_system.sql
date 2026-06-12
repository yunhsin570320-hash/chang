/*
  # Admin System

  1. Modified Tables
    - `profiles`
      - `is_admin` (boolean, default false) — 是否為管理員
      - `is_blocked` (boolean, default false) — 是否被封鎖
      - `blocked_reason` (text, nullable) — 封鎖原因
      - `blocked_at` (timestamptz, nullable) — 封鎖時間
      - `warning_count` (int, default 0) — 警告次數

  2. New Tables
    - `reports` — 檢舉紀錄
      - id, reporter_id, reported_user_id, product_id (nullable), type, reason, status, resolved_by, resolved_at, created_at
    - `admin_actions` — 管理員操作紀錄
      - id, admin_id, target_user_id, product_id (nullable), action_type, reason, created_at

  3. Admin Account
    - email: admin@auction.com / password: admin2024
    - is_admin = true, is_buyer = true, is_seller = true

  4. Security
    - RLS on reports and admin_actions (public for demo)
*/

-- Add admin/block columns to profiles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_admin') THEN
    ALTER TABLE profiles ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_blocked') THEN
    ALTER TABLE profiles ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'blocked_reason') THEN
    ALTER TABLE profiles ADD COLUMN blocked_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'blocked_at') THEN
    ALTER TABLE profiles ADD COLUMN blocked_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'warning_count') THEN
    ALTER TABLE profiles ADD COLUMN warning_count int NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Create admin account (admin@auction.com / admin2024)
INSERT INTO profiles (id, name, email, password_hash, is_buyer, is_seller, is_admin, role, phone, phone_verified, shipping_address)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  '系統管理員',
  'admin@auction.com',
  'admin2024',
  true,
  true,
  true,
  'seller',
  '0900000000',
  true,
  '台北市管理中心'
)
ON CONFLICT (id) DO UPDATE SET
  is_admin = true,
  email = 'admin@auction.com',
  password_hash = 'admin2024';

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('fake_product', 'abandon_bid', 'fraud', 'spam', 'other')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  admin_note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on reports"
  ON reports FOR SELECT TO public USING (true);

CREATE POLICY "Allow public insert on reports"
  ON reports FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public update on reports"
  ON reports FOR UPDATE TO public USING (true) WITH CHECK (true);

-- Create admin_actions table
CREATE TABLE IF NOT EXISTS admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('warn', 'block', 'unblock', 'remove_product', 'approve_product', 'resolve_report', 'dismiss_report')),
  reason text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on admin_actions"
  ON admin_actions FOR SELECT TO public USING (true);

CREATE POLICY "Allow public insert on admin_actions"
  ON admin_actions FOR INSERT TO public WITH CHECK (true);

-- Add is_flagged and flag_reason columns to products for admin review
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'is_flagged') THEN
    ALTER TABLE products ADD COLUMN is_flagged boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'flag_reason') THEN
    ALTER TABLE products ADD COLUMN flag_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'is_approved') THEN
    ALTER TABLE products ADD COLUMN is_approved boolean NOT NULL DEFAULT true;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_user_id ON admin_actions(target_user_id);
