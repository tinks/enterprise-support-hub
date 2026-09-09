ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS outbound_initiated boolean,
  ADD COLUMN IF NOT EXISTS customer_replied boolean;

COMMENT ON COLUMN public.intercom_tickets_v3.outbound_initiated IS
  'Conversation opened by us (admin-initiated / outbound email), not by the customer. Ball starts on the customer side.';
COMMENT ON COLUMN public.intercom_tickets_v3.customer_replied IS
  'Customer authored at least one part after the opening message. outbound_initiated AND NOT customer_replied = outbound-only, no customer response.';