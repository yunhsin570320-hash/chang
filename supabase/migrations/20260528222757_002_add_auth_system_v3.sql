/*
  # Add Authentication System with Dual Roles

  1. Changes to profiles table
    - Remove 'role' column constraint (allow both roles)
    - Add 'is_buyer' and 'is_seller' boolean columns
    - Add 'email' column for login
    - Add 'password_hash' column for authentication
    
  2. Updates existing profiles for demo
*/

-- Drop existing check constraint
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Add new columns for dual roles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE profiles ADD COLUMN email text UNIQUE;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_buyer'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_buyer boolean DEFAULT true;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_seller'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_seller boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE profiles ADD COLUMN password_hash text;
  END IF;
END $$;

-- Update existing profiles to have both roles for demo
UPDATE profiles 
SET 
  is_buyer = true,
  is_seller = (role = 'seller'),
  email = CASE 
    WHEN name = '賣家小明' THEN 'seller1@test.com'
    WHEN name = '買家小華' THEN 'buyer1@test.com'
    WHEN name = '買家小美' THEN 'buyer2@test.com'
    ELSE email
  END,
  password_hash = 'demo123'
WHERE email IS NULL;
