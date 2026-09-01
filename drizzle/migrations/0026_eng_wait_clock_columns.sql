ALTER TABLE public.dev_escalations
  ADD COLUMN IF NOT EXISTS linear_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS linear_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS linear_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS linear_canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS linear_state_type text;

ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS resolution_eng_wait_s integer,
  ADD COLUMN IF NOT EXISTS resolution_eng_wait_bh_s integer,
  ADD COLUMN IF NOT EXISTS eng_wait_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS eng_wait_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS eng_wait_source text;

COMMENT ON COLUMN public.intercom_tickets_v3.resolution_eng_wait_s IS
  'Engineering wait: the slice of waiting-on-customer time that is actually a pending Linear fix. Carved out of resolution_customer_wait_s; never out of resolution_active_s.';
COMMENT ON COLUMN public.intercom_tickets_v3.eng_wait_source IS
  'attribute_event | dev_escalation_row | linear_created — the signal that opened the engineering-wait window.';