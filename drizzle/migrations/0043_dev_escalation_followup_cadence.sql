-- Hub-owned follow-up cadence + dev-fix acknowledgement for My Queue.
-- Additive and nullable: nothing existing reads or writes these yet.
ALTER TABLE public.dev_escalations
  ADD COLUMN IF NOT EXISTS dev_next_followup_at timestamptz,
  ADD COLUMN IF NOT EXISTS dev_followup_source text,
  ADD COLUMN IF NOT EXISTS dev_fix_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS dev_fix_ack_by text;

COMMENT ON COLUMN public.dev_escalations.dev_next_followup_at IS
  'When the next chase with engineering is due. NULL = derive from lifecycle default.';
COMMENT ON COLUMN public.dev_escalations.dev_followup_source IS
  'auto = lifecycle default applied on mark-followed-up; manual = human override.';
COMMENT ON COLUMN public.dev_escalations.dev_fix_ack_at IS
  'Human sign-off that the shipped/canceled Linear fix has been handled with the customer.';

CREATE INDEX IF NOT EXISTS dev_escalations_next_followup_idx
  ON public.dev_escalations (dev_next_followup_at);