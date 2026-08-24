ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS subject_override text,
  ADD COLUMN IF NOT EXISTS subject_override_by uuid,
  ADD COLUMN IF NOT EXISTS subject_override_at timestamptz;

COMMENT ON COLUMN public.intercom_tickets_v3.subject_override IS
  'Hub-only human label. Never written to Intercom, never touched by sync. Display rule: subject_override -> subject -> Untitled.';