-- F8: relisting reopened an auction while keeping the previous round's bids, which
-- were already revealed publicly once the auction ended, and the unique
-- (product_id, bidder_id) constraint locked the original bidders out of bidding
-- again. Clear the finished round's bids as part of the relist.
CREATE OR REPLACE FUNCTION public.rpc_seller_relist_product(p_token text, p_product_id uuid, p_end_time timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_user_id UUID;
v_profile profiles%ROWTYPE;
v_product products%ROWTYPE;
BEGIN
v_user_id := app_get_user_id(p_token);
IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Invalid session'); END IF;

SELECT * INTO v_product FROM products WHERE id = p_product_id;
IF NOT FOUND THEN RETURN jsonb_build_object('error', '找不到商品'); END IF;
IF v_product.seller_id != v_user_id THEN RETURN jsonb_build_object('error', 'Not authorized'); END IF;

SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
IF v_profile.is_blocked THEN
RETURN jsonb_build_object('error', '帳號已鎖定，無法重新上架');
END IF;

-- Free members cannot relist auction products
IF COALESCE(v_profile.membership_tier, 'free') = 'free' AND NOT COALESCE(v_product.is_direct_buy, false) THEN
RETURN jsonb_build_object('error', '免費會員僅可上架直購商品。升級 VIP 會員即可上架競標商品。');
END IF;

-- A relisted auction starts a fresh sealed round.
DELETE FROM bids WHERE product_id = p_product_id;

UPDATE products SET status = 'active', end_time = p_end_time, winner_id = NULL, winning_amount = NULL
WHERE id = p_product_id;

RETURN jsonb_build_object('success', true);
END;
$function$;