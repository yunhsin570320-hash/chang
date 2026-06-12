/*
  # Fix notifications INSERT policy — scope to product sellers only

  The previous policy allowed any authenticated user to insert notifications
  for any user_id. The only legitimate client-side INSERT is sendAuctionNotifications,
  called by a seller when closing their auction.

  New rule: a user may insert a notification only if they are the seller of the
  referenced product (products.seller_id = auth.uid()).
  This covers the won/lost notifications sent to all bidders at auction close.

  The admin notification path (admin.tsx) inserts with product_id = null — we add
  a second narrow policy to allow admins to insert system notifications.
*/

DROP POLICY IF EXISTS "Authenticated can insert notifications for any user" ON notifications;

-- Sellers can notify bidders on their own products
CREATE POLICY "Sellers can insert notifications for own products"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    product_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM products
      WHERE products.id = notifications.product_id
        AND products.seller_id = auth.uid()
    )
  );

-- Admins can insert system notifications (product_id may be null)
CREATE POLICY "Admins can insert system notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );
