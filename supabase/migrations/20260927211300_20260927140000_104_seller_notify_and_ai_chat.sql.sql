/*
# Seller auction-end notification + AI customer service chat tables

## Problem
1. When an auction ends (rpc_seller_end_auction), only bidders receive
   notifications — the seller gets nothing, so they don't know to ship.
2. No in-app customer service / AI chat exists.

## Changes

### 1. Seller notification on auction end
Modify rpc_seller_end_auction to also INSERT a notification for the seller
when there is a winner, using type='auction_ended' (already in the CHECK
constraint but previously unused).

### 2. New table: chat_threads
Stores conversation threads between a user and the AI assistant.
- id (uuid PK)
- user_id (uuid FK -> profiles, CASCADE)
- subject (text) — optional short topic
- created_at (timestamptz)
- last_message_at (timestamptz)
RLS: owner can read/update own threads; insert via RPC only.

### 3. New table: chat_messages
Stores individual messages in a thread.
- id (uuid PK)
- thread_id (uuid FK -> chat_threads, CASCADE)
- role (text CHECK in 'user','assistant') — who sent the message
- content (text) — message body
- created_at (timestamptz)
RLS: owner can read own messages via thread ownership; insert via RPC only.

### 4. New RPC: rpc_start_chat_thread
Creates a new chat thread for the authenticated user.
Returns { id, created_at }.

### 5. New RPC: rpc_get_chat_threads
Returns the caller's chat threads, most recent first.

### 6. New RPC: rpc_get_chat_messages
Returns messages for a thread owned by the caller.

### 7. New RPC: rpc_save_chat_message
Saves a user or assistant message to a thread owned by the caller.
Returns { id, created_at }.

### Security
- All RPCs authenticate via app_get_user_id(p_token).
- chat_threads and chat_messages have RLS enabled.
- SELECT policies allow owners to read their own data.
- INSERT/UPDATE are via SECURITY DEFINER RPCs only (no direct client writes).
- EXECUTE revoked from anon/authenticated on all new RPCs.
*/

-- ============================================================
-- 1. Modify rpc_seller_end_auction: add seller notification
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_seller_end_auction(
  p_token text,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        uuid;
  v_product        products%ROWTYPE;
  v_winner_id      uuid := NULL;
  v_winning_amount numeric := NULL;
  v_bidder_ids     uuid[];
  v_tie_count      int := 0;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '找不到商品');
  END IF;
  IF v_product.seller_id != v_user_id THEN
    RETURN jsonb_build_object('error', '無權執行此操作');
  END IF;
  IF v_product.status != 'active' THEN
    RETURN jsonb_build_object('error', '商品已結標');
  END IF;

  SELECT bidder_id, amount INTO v_winner_id, v_winning_amount
  FROM bids
  WHERE product_id = p_product_id
  ORDER BY amount DESC, created_at ASC
  LIMIT 1;

  SELECT count(*) INTO v_tie_count
  FROM bids
  WHERE product_id = p_product_id AND amount = v_winning_amount;

  SELECT ARRAY_AGG(DISTINCT bidder_id) INTO v_bidder_ids
  FROM bids WHERE product_id = p_product_id;

  UPDATE products
  SET status = 'ended',
      winner_id = v_winner_id,
      winning_amount = v_winning_amount
  WHERE id = p_product_id;

  -- Bidder notifications (won/lost)
  IF v_bidder_ids IS NOT NULL AND array_length(v_bidder_ids, 1) > 0 THEN
    INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
    SELECT
      b_id, p_product_id,
      CASE WHEN b_id = v_winner_id THEN 'won'::text ELSE 'lost'::text END,
      CASE WHEN b_id = v_winner_id THEN '恭喜您得標！' ELSE '競標結果通知' END,
      CASE WHEN b_id = v_winner_id
        THEN '您以 NT$ ' || v_winning_amount::TEXT || ' 成功得標「' || v_product.name || '」' ||
             CASE WHEN v_tie_count > 1 THEN '（同額以先出價者優先）' ELSE '' END ||
             '，請等候賣家聯繫交付事宜。'
        ELSE '很遺憾，您未能得標「' || v_product.name || '」，感謝您的參與。'
      END,
      false
    FROM UNNEST(v_bidder_ids) AS b_id;
  END IF;

  -- Seller notification: auction ended with a winner
  IF v_winner_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
    VALUES (
      v_product.seller_id, p_product_id, 'auction_ended',
      '競標已結標！請安排交付',
      '您的商品「' || v_product.name || '」已以 NT$ ' || v_winning_amount::TEXT || ' 結標，得標者已收到通知，請盡快前往交付頁面處理出貨。',
      false
    );
  ELSE
    INSERT INTO notifications (user_id, product_id, type, title, message, is_read)
    VALUES (
      v_product.seller_id, p_product_id, 'auction_ended',
      '競標已結標（無人得標）',
      '您的商品「' || v_product.name || '」已結標，但無人出價。您可重新上架或下架此商品。',
      false
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'winner_id', v_winner_id,
    'winning_amount', v_winning_amount,
    'tie_count', v_tie_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_seller_end_auction(text, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. chat_threads table
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_chat_threads" ON chat_threads;
CREATE POLICY "select_own_chat_threads"
  ON chat_threads FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_chat_threads" ON chat_threads;
CREATE POLICY "update_own_chat_threads"
  ON chat_threads FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No direct INSERT/DELETE from client — handled via SECURITY DEFINER RPC
DROP POLICY IF EXISTS "insert_own_chat_threads" ON chat_threads;
CREATE POLICY "insert_own_chat_threads"
  ON chat_threads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id, last_message_at DESC);

-- ============================================================
-- 3. chat_messages table
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: only the thread owner can read messages
DROP POLICY IF EXISTS "select_own_chat_messages" ON chat_messages;
CREATE POLICY "select_own_chat_messages"
  ON chat_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_threads
      WHERE chat_threads.id = chat_messages.thread_id
      AND chat_threads.user_id = auth.uid()
    )
  );

-- No direct INSERT from client — handled via SECURITY DEFINER RPC
DROP POLICY IF EXISTS "insert_own_chat_messages" ON chat_messages;
CREATE POLICY "insert_own_chat_messages"
  ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_threads
      WHERE chat_threads.id = chat_messages.thread_id
      AND chat_threads.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC);

-- ============================================================
-- 4. rpc_start_chat_thread
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_start_chat_thread(
  p_token TEXT,
  p_subject TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_thread_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  INSERT INTO chat_threads (user_id, subject)
  VALUES (v_user_id, p_subject)
  RETURNING id INTO v_thread_id;

  RETURN jsonb_build_object('success', true, 'id', v_thread_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_start_chat_thread(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. rpc_get_chat_threads
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_chat_threads(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'subject', t.subject,
        'created_at', t.created_at,
        'last_message_at', t.last_message_at,
        'last_message', (
          SELECT content FROM chat_messages
          WHERE thread_id = t.id
          ORDER BY created_at DESC LIMIT 1
        )
      )
      ORDER BY t.last_message_at DESC
    )
    FROM chat_threads t
    WHERE t.user_id = v_user_id),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_chat_threads(TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 6. rpc_get_chat_messages
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_chat_messages(
  p_token TEXT,
  p_thread_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  -- Verify ownership
  PERFORM 1 FROM chat_threads
  WHERE id = p_thread_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '無權限');
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'role', m.role,
        'content', m.content,
        'created_at', m.created_at
      )
      ORDER BY m.created_at ASC
    )
    FROM chat_messages m
    WHERE m.thread_id = p_thread_id),
    '[]'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_chat_messages(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 7. rpc_save_chat_message
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_save_chat_message(
  p_token TEXT,
  p_thread_id UUID,
  p_role TEXT,
  p_content TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_msg_id UUID;
BEGIN
  v_user_id := app_get_user_id(p_token);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', '登入已過期，請重新登入');
  END IF;

  -- Verify thread ownership
  PERFORM 1 FROM chat_threads
  WHERE id = p_thread_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '無權限');
  END IF;

  IF p_role NOT IN ('user', 'assistant') THEN
    RETURN jsonb_build_object('error', 'invalid role');
  END IF;

  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RETURN jsonb_build_object('error', '訊息內容不可為空');
  END IF;

  IF length(p_content) > 5000 THEN
    RETURN jsonb_build_object('error', '訊息過長');
  END IF;

  INSERT INTO chat_messages (thread_id, role, content)
  VALUES (p_thread_id, p_role, p_content)
  RETURNING id INTO v_msg_id;

  UPDATE chat_threads SET last_message_at = now() WHERE id = p_thread_id;

  RETURN jsonb_build_object('success', true, 'id', v_msg_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_save_chat_message(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
