/*
  # Phone Verification System

  1. Modified Tables
    - `profiles`
      - `phone_verified` (boolean, default false) — 是否已驗證電話
      - `phone_verified_at` (timestamptz, nullable) — 驗證時間

  2. New Tables
    - `phone_verifications`
      - `id` (uuid, pk)
      - `user_id` (uuid, fk profiles)
      - `phone` (text) — 待驗證的電話號碼
      - `code` (text) — 6位數驗證碼
      - `expires_at` (timestamptz) — 10分鐘後過期
      - `used` (boolean, default false) — 是否已使用
      - `created_at` (timestamptz)

  3. Security
    - RLS on phone_verifications: public read/insert/update (demo mode, no SMS provider)
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'phone_verified') THEN
    ALTER TABLE profiles ADD COLUMN phone_verified boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'phone_verified_at') THEN
    ALTER TABLE profiles ADD COLUMN phone_verified_at timestamptz;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS phone_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE phone_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert on phone_verifications"
  ON phone_verifications FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public select on phone_verifications"
  ON phone_verifications FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public update on phone_verifications"
  ON phone_verifications FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_user_id ON phone_verifications(user_id);
