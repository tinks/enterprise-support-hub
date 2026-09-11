ALTER TABLE public.dev_escalations
  ADD COLUMN IF NOT EXISTS dev_workaround_at timestamptz,
  ADD COLUMN IF NOT EXISTS dev_workaround_by text,
  ADD COLUMN IF NOT EXISTS dev_workaround_note text;