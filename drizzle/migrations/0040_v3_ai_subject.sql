ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS subject_ai text,
  ADD COLUMN IF NOT EXISTS subject_ai_at timestamptz,
  ADD COLUMN IF NOT EXISTS subject_ai_model text,
  ADD COLUMN IF NOT EXISTS subject_ai_source_hash text;

COMMENT ON COLUMN public.intercom_tickets_v3.subject_ai IS
  'AI-written Hub label. Never written to Intercom, never touched by sync. Display rule: subject_override -> subject_ai -> subject -> Untitled.';
COMMENT ON COLUMN public.intercom_tickets_v3.subject_ai_source_hash IS
  'SHA-256 of the thread text the AI subject was generated from. Unchanged hash = skip, so a re-run costs nothing.';

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS subject_ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS subject_ai_daily_call_cap integer NOT NULL DEFAULT 200;

CREATE INDEX IF NOT EXISTS idx_v3_subject_ai_pending
  ON public.intercom_tickets_v3 (state)
  WHERE subject_ai IS NULL AND subject_override IS NULL;