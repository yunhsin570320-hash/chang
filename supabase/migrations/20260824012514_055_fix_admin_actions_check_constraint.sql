/*
# Fix: Allow delete_product and batch_delete_ended in admin_actions

## Bug
admin_actions has a CHECK constraint on action_type that only allows:
  warn, block, unblock, remove_product, approve_product,
  resolve_report, dismiss_report

The delete functions use 'delete_product' and 'batch_delete_ended' which
are not in the allowed list, causing a constraint violation that aborts
the entire transaction.
*/

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_action_type_check;

ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'warn'::text, 'block'::text, 'unblock'::text,
    'remove_product'::text, 'approve_product'::text,
    'resolve_report'::text, 'dismiss_report'::text,
    'delete_product'::text, 'batch_delete_ended'::text
  ]));
