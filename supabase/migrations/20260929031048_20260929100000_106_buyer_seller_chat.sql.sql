-- Buyer-seller direct messaging system: dm_conversations + dm_messages
-- Conversations are 1:1 between two users, optionally tied to a product.

CREATE TABLE IF NOT EXISTS dm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  participant_b uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  last_message text,
  last_message_at timestamptz DEFAULT now(),
  last_sender_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT dm_conversations_participants_different CHECK (participant_a <> participant_b)
);

CREATE INDEX idx_dm_conv_pa ON dm_conversations (participant_a, last_message_at DESC);
CREATE INDEX idx_dm_conv_pb ON dm_conversations (participant_b, last_message_at DESC);
CREATE INDEX idx_dm_conv_product ON dm_conversations (product_id);

CREATE TABLE IF NOT EXISTS dm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_dm_msg_conv ON dm_messages (conversation_id, created_at ASC);
CREATE INDEX idx_dm_msg_unread ON dm_messages (conversation_id, is_read) WHERE is_read = false;

-- RLS
ALTER TABLE dm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON dm_conversations FROM anon, authenticated;
REVOKE ALL ON dm_messages FROM anon, authenticated;
GRANT SELECT ON dm_conversations TO authenticated;
GRANT SELECT ON dm_messages TO authenticated;

-- ========== RPCs ==========

-- Start or resume a conversation with another user
CREATE OR REPLACE FUNCTION rpc_start_conversation(
  p_token uuid,
  p_other_user_id uuid,
  p_product_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_conversation_id uuid;
  v_other_name text;
  v_other_blocked boolean;
BEGIN
  SELECT id INTO v_user_id FROM sessions WHERE token = p_token AND expires_at > now();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '登入已過期，請重新登入';
  END IF;

  SELECT name, is_blocked INTO v_other_name, v_other_blocked
  FROM profiles WHERE id = p_other_user_id;
  IF v_other_name IS NULL THEN
    RAISE EXCEPTION '找不到該用戶';
  END IF;
  IF v_other_blocked THEN
    RAISE EXCEPTION '該用戶帳號已被鎖定，無法發送訊息';
  END IF;
  IF v_user_id = p_other_user_id THEN
    RAISE EXCEPTION '無法與自己開啟對話';
  END IF;

  SELECT id INTO v_conversation_id
  FROM dm_conversations
  WHERE (participant_a = v_user_id AND participant_b = p_other_user_id
         OR participant_a = p_other_user_id AND participant_b = v_user_id)
    AND (p_product_id IS NULL OR product_id = p_product_id)
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    INSERT INTO dm_conversations (participant_a, participant_b, product_id)
    VALUES (v_user_id, p_other_user_id, p_product_id)
    RETURNING id INTO v_conversation_id;
  END IF;

  RETURN json_build_object(
    'conversation_id', v_conversation_id,
    'other_user_name', v_other_name
  );
END;
$$;

-- Send a message
CREATE OR REPLACE FUNCTION rpc_send_chat_message(
  p_token uuid,
  p_conversation_id uuid,
  p_content text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_message_id uuid;
  v_other_id uuid;
  v_sender_name text;
BEGIN
  SELECT id INTO v_user_id FROM sessions WHERE token = p_token AND expires_at > now();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '登入已過期，請重新登入';
  END IF;

  IF btrim(p_content) = '' THEN
    RAISE EXCEPTION '訊息內容不可為空';
  END IF;
  IF length(p_content) > 2000 THEN
    RAISE EXCEPTION '訊息過長，請限制在 2000 字以內';
  END IF;

  SELECT
    CASE WHEN participant_a = v_user_id THEN participant_b
         WHEN participant_b = v_user_id THEN participant_a
         ELSE NULL END
  INTO v_other_id
  FROM dm_conversations WHERE id = p_conversation_id;

  IF v_other_id IS NULL THEN
    RAISE EXCEPTION '找不到此對話或您無權發送訊息';
  END IF;

  INSERT INTO dm_messages (conversation_id, sender_id, content)
  VALUES (p_conversation_id, v_user_id, p_content)
  RETURNING id INTO v_message_id;

  UPDATE dm_conversations
  SET last_message = p_content, last_message_at = now(), last_sender_id = v_user_id
  WHERE id = p_conversation_id;

  SELECT name INTO v_sender_name FROM profiles WHERE id = v_user_id;
  INSERT INTO notifications (user_id, type, title, message, product_id, is_read)
  VALUES (v_other_id, 'new_message',
    '新訊息',
    COALESCE(v_sender_name, '用戶') || '：' || substring(p_content from 1 for 50),
    NULL, false);

  RETURN json_build_object('message_id', v_message_id, 'created_at', now());
END;
$$;

-- List conversations for current user
CREATE OR REPLACE FUNCTION rpc_get_conversations(p_token uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM sessions WHERE token = p_token AND expires_at > now();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '登入已過期，請重新登入';
  END IF;

  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', c.id,
        'other_user_id', CASE WHEN c.participant_a = v_user_id THEN c.participant_b ELSE c.participant_a END,
        'other_user_name', CASE WHEN c.participant_a = v_user_id THEN pb.name ELSE pa.name END,
        'other_user_blocked', CASE WHEN c.participant_a = v_user_id THEN pb.is_blocked ELSE pa.is_blocked END,
        'product_id', c.product_id,
        'last_message', c.last_message,
        'last_message_at', c.last_message_at,
        'last_sender_id', c.last_sender_id,
        'unread_count',
          (SELECT count(*)::int FROM dm_messages dm
           WHERE dm.conversation_id = c.id AND dm.sender_id <> v_user_id AND dm.is_read = false),
        'created_at', c.created_at
      )
      ORDER BY c.last_message_at DESC
    )
    FROM dm_conversations c
    LEFT JOIN profiles pa ON pa.id = c.participant_a
    LEFT JOIN profiles pb ON pb.id = c.participant_b
    WHERE c.participant_a = v_user_id OR c.participant_b = v_user_id
  );
END;
$$;

-- Get messages in a conversation (marks as read)
CREATE OR REPLACE FUNCTION rpc_get_conversation_messages(
  p_token uuid,
  p_conversation_id uuid,
  p_limit int DEFAULT 100
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_participant boolean;
BEGIN
  SELECT id INTO v_user_id FROM sessions WHERE token = p_token AND expires_at > now();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '登入已過期，請重新登入';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM dm_conversations
    WHERE id = p_conversation_id
      AND (participant_a = v_user_id OR participant_b = v_user_id)
  ) INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION '找不到此對話或您無權查看';
  END IF;

  UPDATE dm_messages SET is_read = true
  WHERE conversation_id = p_conversation_id AND sender_id <> v_user_id AND is_read = false;

  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', m.id, 'sender_id', m.sender_id, 'content', m.content,
        'is_read', m.is_read, 'created_at', m.created_at
      )
      ORDER BY m.created_at ASC
    )
    FROM dm_messages m WHERE m.conversation_id = p_conversation_id LIMIT p_limit
  );
END;
$$;

-- Get unread message count for badge
CREATE OR REPLACE FUNCTION rpc_get_unread_message_count(p_token uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_count int;
BEGIN
  SELECT id INTO v_user_id FROM sessions WHERE token = p_token AND expires_at > now();
  IF v_user_id IS NULL THEN RETURN 0; END IF;

  SELECT count(*)::int INTO v_count
  FROM dm_messages m
  JOIN dm_conversations c ON c.id = m.conversation_id
  WHERE m.sender_id <> v_user_id AND m.is_read = false
    AND (c.participant_a = v_user_id OR c.participant_b = v_user_id);

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_start_conversation(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_send_chat_message(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_get_conversations(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_get_conversation_messages(uuid, uuid, int) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_get_unread_message_count(uuid) FROM anon;