ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS resolution_customer_wait_s integer,
  ADD COLUMN IF NOT EXISTS resolution_customer_wait_bh_s integer,
  ADD COLUMN IF NOT EXISTS resolution_window_s integer;

COMMENT ON COLUMN public.intercom_tickets_v3.resolution_customer_wait_s IS
  'Waiting-on-customer seconds inside the resolution window (ball not with us, ticket open). Mirror of resolution_active_s.';
COMMENT ON COLUMN public.intercom_tickets_v3.resolution_customer_wait_bh_s IS
  'Waiting-on-customer seconds clipped to Europe/Berlin business hours.';
COMMENT ON COLUMN public.intercom_tickets_v3.resolution_window_s IS
  'close_at - sla_clock_start. Identity: resolution_active_s + resolution_closed_s + resolution_customer_wait_s = resolution_window_s.';