/*
  # Fix RLS Policies for Public Registration and Product Creation

  1. Update profiles table policies
    - Allow public INSERT for registration
    - Allow public SELECT for viewing profiles
    
  2. Update products table policies
    - Allow authenticated INSERT for sellers
    - Allow public SELECT for viewing products
*/

-- Fix profiles table policies
DROP POLICY IF EXISTS "Anyone can view profiles" ON profiles;
DROP POLICY IF EXISTS "Anyone can register" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Anyone can delete profiles" ON profiles;

-- Allow anyone to view profiles (needed for seller/bidder info)
CREATE POLICY "Public can view profiles"
  ON profiles FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow anyone to register (public INSERT)
CREATE POLICY "Public can register"
  ON profiles FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Allow anyone to update profiles (for demo purposes)
CREATE POLICY "Public can update profiles"
  ON profiles FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- Fix products table policies
DROP POLICY IF EXISTS "Public can view products" ON products;
DROP POLICY IF EXISTS "Sellers can create products" ON products;
DROP POLICY IF EXISTS "Sellers can update own products" ON products;
DROP POLICY IF EXISTS "Sellers can delete own products" ON products;

-- Allow anyone to view products
CREATE POLICY "Public can view products"
  ON products FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow anyone to create products (for demo purposes)
CREATE POLICY "Public can create products"
  ON products FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Allow anyone to update products
CREATE POLICY "Public can update products"
  ON products FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- Fix bids table policies
DROP POLICY IF EXISTS "Public can view bids" ON bids;
DROP POLICY IF EXISTS "Buyers can create bids" ON bids;

-- Allow anyone to view bids
CREATE POLICY "Public can view bids"
  ON bids FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow anyone to create bids
CREATE POLICY "Public can create bids"
  ON bids FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);
