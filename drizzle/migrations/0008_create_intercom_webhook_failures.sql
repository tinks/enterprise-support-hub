CREATE TABLE public.intercom_webhook_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  topic text,
  intercom_conversation_id text,
  error text NOT NULL,
  payload jsonb NOT NULL,
  replayed_at timestamptz,
  replay_ok boolean
);

CREATE INDEX idx_intercom_webhook_failures_created_at
  ON public.intercom_webhook_failures (created_at DESC);

GRANT SELECT ON public.intercom_webhook_failures TO authenticated;
GRANT ALL ON public.intercom_webhook_failures TO service_role;

ALTER TABLE public.intercom_webhook_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read webhook failures"
  ON public.intercom_webhook_failures
  FOR SELECT
  TO authenticated
  USING (true);