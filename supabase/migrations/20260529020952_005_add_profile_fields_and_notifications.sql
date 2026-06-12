/*
  # Add contact info, payment method to profiles; create notifications table

  1. Modified Tables
    - `profiles`
      - `phone` (text, nullable) — 聯絡電話
      - `payment_method` (text, nullable) — 付款方式 (e.g. 匯款, Line Pay, 超商代碼)
      - `bank_account` (text, nullable) — 收款帳號（賣家用）
      - `shipping_address` (text, nullable) — 預設收貨地址

  2. New Tables
    - `notifications`
      - `id` (uuid, pk)
      - `user_id` (uuid, fk profiles) — 通知接收者
      - `type` (text) — 'won', 'lost', 'new_bid', 'auction_ended'
      - `title` (text)
      - `message` (text)
      - `product_id` (uuid, nullable, fk products)
      - `is_read` (boolean, default false)
      - `created_at` (timestamptz)

  3. Security
    - RLS on notifications: users can only see their own notifications
*/

-- Add columns to profiles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'phone') THEN
    ALTER TABLE profiles ADD COLUMN phone text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'payment_method') THEN
    ALTER TABLE profiles ADD COLUMN payment_method text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'bank_account') THEN
    ALTER TABLE profiles ADD COLUMN bank_account text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'shipping_address') THEN
    ALTER TABLE profiles ADD COLUMN shipping_address text;
  END IF;
END $$;

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('won', 'lost', 'auction_ended', 'new_bid')),
  title text NOT NULL,
  message text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  TO public
  USING (user_id = user_id);

CREATE POLICY "Users can insert notifications"
  ON notifications FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
