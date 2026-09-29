/*
# Remove ambiguous legacy chat RPC overloads

1. Changes
- Remove the obsolete `uuid` token overloads for the five buyer/seller chat RPCs.
- Keep the current `text` token versions, which match the application's `app_sessions.token` column and session token format.

2. Functions affected
- `rpc_start_conversation(uuid, uuid, uuid)`
- `rpc_send_chat_message(uuid, uuid, text)`
- `rpc_get_conversations(uuid)`
- `rpc_get_conversation_messages(uuid, uuid, integer)`
- `rpc_get_unread_message_count(uuid)`

3. Data safety
- No tables, rows, columns, or messages are deleted.
- The active text-token chat functions remain unchanged.

4. Security
- Removing duplicate overloads prevents ambiguous API function resolution.
- Existing execution permissions on the active text-token functions are unchanged.
*/

DROP FUNCTION IF EXISTS public.rpc_start_conversation(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_send_chat_message(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.rpc_get_conversations(uuid);
DROP FUNCTION IF EXISTS public.rpc_get_conversation_messages(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.rpc_get_unread_message_count(uuid);