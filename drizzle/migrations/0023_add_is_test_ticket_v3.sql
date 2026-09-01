ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS is_test_ticket boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_marked_by uuid,
  ADD COLUMN IF NOT EXISTS test_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS test_marked_reason text;

CREATE INDEX IF NOT EXISTS idx_v3_is_test_ticket
  ON public.intercom_tickets_v3 (is_test_ticket)
  WHERE is_test_ticket = true;