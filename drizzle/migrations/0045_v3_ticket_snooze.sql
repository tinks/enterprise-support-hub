ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_at timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_by text,
  ADD COLUMN IF NOT EXISTS snooze_reason text;

CREATE INDEX IF NOT EXISTS idx_v3_snoozed_until
  ON public.intercom_tickets_v3 (snoozed_until)
  WHERE snoozed_until IS NOT NULL;