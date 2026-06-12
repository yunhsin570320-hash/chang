-- Replace unrestricted bids INSERT policy with one that enforces active status
DROP POLICY IF EXISTS "Anyone can insert bids" ON bids;

CREATE POLICY "insert_bids_active_only" ON bids FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = bids.product_id
        AND products.status = 'active'
    )
  );
