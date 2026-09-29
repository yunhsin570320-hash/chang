/*
# Allow notifications for direct messages

1. Changes
- Extend the existing `notifications_type_check` constraint to allow `new_message`.
- This supports the buyer/seller direct-message notification created by `rpc_send_chat_message`.

2. Data safety
- No tables, rows, columns, or existing notification values are deleted or changed.
- Existing allowed notification types remain valid.

3. Security
- The change only expands the set of server-generated notification types.
- Notifications continue to use the existing table permissions and policies.
*/

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'won'::text,
    'lost'::text,
    'auction_ended'::text,
    'new_bid'::text,
    'new_message'::text
  ]));