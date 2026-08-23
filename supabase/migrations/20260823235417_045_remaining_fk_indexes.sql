-- Add remaining missing FK indexes
-- admin_actions target_user_id (column 3)
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_user_id_fkey ON admin_actions (target_user_id);

-- deliveries seller_id and winner_id (columns 4 and 3)
CREATE INDEX IF NOT EXISTS idx_deliveries_seller_id_fkey ON deliveries (seller_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_winner_id_fkey ON deliveries (winner_id);

-- material_transactions operator_id (column 2) — different from earlier index name
CREATE INDEX IF NOT EXISTS idx_material_transactions_operator_fkey ON material_transactions (operator_id);

-- notifications user_id (column 2)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_fkey ON notifications (user_id);

-- phone_verifications user_id (column 2)
CREATE INDEX IF NOT EXISTS idx_phone_verifications_user_id_fkey ON phone_verifications (user_id);

-- production_consumption order_id (column 2)
CREATE INDEX IF NOT EXISTS idx_production_consumption_order_fkey ON production_consumption (order_id);

-- reports reported_user_id (column 3)
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_fkey ON reports (reported_user_id);
