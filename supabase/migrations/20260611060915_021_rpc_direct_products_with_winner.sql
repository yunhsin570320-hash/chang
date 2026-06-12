CREATE OR REPLACE FUNCTION get_direct_products()
RETURNS json LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(
    (
      SELECT json_agg(t ORDER BY t.created_at DESC)
      FROM (
        SELECT
          p.id, p.name, p.description, p.image_url, p.seller_id,
          p.end_time, p.status, p.winner_id, p.winning_amount,
          p.created_at, p.is_flagged, p.flag_reason, p.is_approved,
          p.is_archived, p.reserve_price, p.is_direct_buy,
          p.direct_price, p.stock_quantity,
          json_build_object('id', s.id, 'name', s.name) AS seller,
          CASE WHEN p.winner_id IS NOT NULL
            THEN json_build_object('id', w.id, 'name', w.name)
            ELSE NULL
          END AS winner
        FROM products p
        LEFT JOIN profiles s ON s.id = p.seller_id
        LEFT JOIN profiles w ON w.id = p.winner_id
        WHERE p.is_approved = true
          AND p.is_direct_buy = true
      ) t
    ),
    '[]'::json
  );
$$;
