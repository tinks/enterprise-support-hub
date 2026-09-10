CREATE TABLE IF NOT EXISTS public.slack_event_claims (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  channel_id TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'processing'
);

CREATE INDEX IF NOT EXISTS idx_slack_event_claims_claimed_at
  ON public.slack_event_claims (claimed_at DESC);

CREATE TABLE IF NOT EXISTS public.slack_event_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT,
  event_type TEXT,
  channel_id TEXT,
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_slack_event_failures_created_at
  ON public.slack_event_failures (created_at DESC);

GRANT SELECT ON public.slack_event_claims TO authenticated;
GRANT ALL ON public.slack_event_claims TO service_role;
GRANT SELECT ON public.slack_event_failures TO authenticated;
GRANT ALL ON public.slack_event_failures TO service_role;

ALTER TABLE public.slack_event_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_event_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read slack event claims"
  ON public.slack_event_claims FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can read slack event failures"
  ON public.slack_event_failures FOR SELECT TO authenticated USING (true);