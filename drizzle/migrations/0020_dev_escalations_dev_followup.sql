ALTER TABLE public.dev_escalations
  ADD COLUMN IF NOT EXISTS dev_followed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS dev_followed_up_by text;