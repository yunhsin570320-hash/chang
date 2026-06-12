/*
  # Create Deliveries Table

  1. New Tables
    - `deliveries`
      - id (uuid, primary key)
      - product_id (uuid, references products)
      - winner_id (uuid, references profiles)
      - seller_id (uuid, references profiles)
      - status (text: pending, shipped, delivered, completed)
      - tracking_number (text)
      - shipping_address (text)
      - contact_phone (text)
      - notes (text)
      - created_at (timestamp)
      - updated_at (timestamp)
    
  2. Security
    - Enable RLS on deliveries table
    - Add policies for public access (demo mode)
*/

CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  winner_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  tracking_number text,
  shipping_address text,
  contact_phone text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view deliveries"
  ON deliveries FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Public can create deliveries"
  ON deliveries FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY "Public can update deliveries"
  ON deliveries FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_deliveries_product_id ON deliveries(product_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_winner_id ON deliveries(winner_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_seller_id ON deliveries(seller_id);
