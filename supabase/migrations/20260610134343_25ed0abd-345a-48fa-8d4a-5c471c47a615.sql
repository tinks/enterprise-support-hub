ALTER TABLE public.integration_health
  ADD COLUMN IF NOT EXISTS last_alerted_status text,
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;