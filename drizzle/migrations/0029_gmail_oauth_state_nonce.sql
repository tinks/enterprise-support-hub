CREATE TABLE public.gmail_oauth_states (
  state TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  created_by UUID
);

GRANT ALL ON public.gmail_oauth_states TO service_role;

ALTER TABLE public.gmail_oauth_states ENABLE ROW LEVEL SECURITY;

-- No policies: only the service role (edge functions) may touch this table.

CREATE OR REPLACE FUNCTION public.gmail_connection_status()
RETURNS TABLE (connected BOOLEAN, email_address TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.gmail_oauth_tokens) AS connected,
    (SELECT t.email_address FROM public.gmail_oauth_tokens t
      ORDER BY t.created_at DESC LIMIT 1) AS email_address;
$$;

REVOKE EXECUTE ON FUNCTION public.gmail_connection_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gmail_connection_status() TO authenticated, service_role;