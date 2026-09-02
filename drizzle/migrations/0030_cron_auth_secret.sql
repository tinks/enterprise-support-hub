CREATE TABLE IF NOT EXISTS public.cron_auth (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  secret text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cron_auth TO service_role;

ALTER TABLE public.cron_auth ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cron_auth (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.esh_cron_headers()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'Content-Type', 'application/json',
    'x-esh-cron-secret', (SELECT secret FROM public.cron_auth WHERE id)
  )
$$;

REVOKE ALL ON FUNCTION public.esh_cron_headers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.esh_cron_headers() FROM anon, authenticated;