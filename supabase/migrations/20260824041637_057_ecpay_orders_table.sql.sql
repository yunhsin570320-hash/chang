/*
# ECPay Integration — Order Tracking Table

## Overview
Creates `ecpay_orders` table to track ECPay (綠界科技) payment transactions.
This enables real online payments (credit card, ATM, convenience store) through
ECPay's AIO (All-In-One) payment gateway, replacing the manual "I've paid" flow.

## New Tables
- `ecpay_orders`
  - `id` (uuid, PK)
  - `delivery_id` (uuid, FK to deliveries) — the delivery this payment is for
  - `merchant_trade_no` (text, unique) — ECPay trade number (max 20 chars)
  - `total_amount` (integer) — payment amount in NTD
  - `item_name` (text) — product name for ECPay display
  - `trade_status` (text) — 'pending' | 'paid' | 'failed' | 'expired'
  - `payment_type` (text, nullable) — e.g. 'Credit', 'ATM', 'CVS' (returned by ECPay)
  - `trade_date` (text, nullable) — ECPay trade date
  - `ecpay_trade_no` (text, nullable) — ECPay's internal trade number
  - `ecpay_check_mac_value` (text, nullable) — verification checksum from callback
  - `paid_at` (timestamptz, nullable) — when payment was confirmed
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

## Security
- RLS enabled on `ecpay_orders`.
- Buyers can see their own payment orders (joined via deliveries.winner_id).
- Sellers can see payment orders for their deliveries (joined via deliveries.seller_id).
- All writes go through SECURITY DEFINER RPCs — no direct client inserts/updates.
- The ECPay callback edge function uses the service role key to update trade_status.
*/
CREATE TABLE IF NOT EXISTS ecpay_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  merchant_trade_no text UNIQUE NOT NULL,
  total_amount integer NOT NULL,
  item_name text NOT NULL,
  trade_status text NOT NULL DEFAULT 'pending',
  payment_type text,
  trade_date text,
  ecpay_trade_no text,
  ecpay_check_mac_value text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecpay_orders_delivery_id ON ecpay_orders(delivery_id);
CREATE INDEX IF NOT EXISTS idx_ecpay_orders_trade_status ON ecpay_orders(trade_status);
CREATE INDEX IF NOT EXISTS idx_ecpay_orders_merchant_trade_no ON ecpay_orders(merchant_trade_no);

ALTER TABLE ecpay_orders ENABLE ROW LEVEL SECURITY;

-- Buyers can view their own payment orders
DROP POLICY IF EXISTS "select_own_ecpay_orders" ON ecpay_orders;
CREATE POLICY "select_own_ecpay_orders" ON ecpay_orders FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM deliveries
      WHERE deliveries.id = ecpay_orders.delivery_id
      AND deliveries.winner_id = auth.uid()
    )
  );

-- Sellers can view payment orders for their deliveries
DROP POLICY IF EXISTS "select_seller_ecpay_orders" ON ecpay_orders;
CREATE POLICY "select_seller_ecpay_orders" ON ecpay_orders FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM deliveries
      WHERE deliveries.id = ecpay_orders.delivery_id
      AND deliveries.seller_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies — all writes via RPC (SECURITY DEFINER)

-- Helper: generate a unique merchant trade number
CREATE OR REPLACE FUNCTION public.generate_merchant_trade_no()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'EC' || to_char(now(), 'YYYYMMDDHH24MISS') || lpad(floor(random() * 10000)::text, 4, '0');
$$;
