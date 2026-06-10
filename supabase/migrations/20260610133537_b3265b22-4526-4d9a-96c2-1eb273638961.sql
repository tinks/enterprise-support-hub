CREATE TABLE public.integration_health (
  integration text PRIMARY KEY,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_status text,
  last_error text,
  consecutive_failures int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.integration_health TO authenticated;
GRANT ALL ON public.integration_health TO service_role;

ALTER TABLE public.integration_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read integration health"
ON public.integration_health
FOR SELECT
TO authenticated
USING (true);
