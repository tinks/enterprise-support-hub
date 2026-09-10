CREATE TABLE IF NOT EXISTS public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  slack_user_id text,
  slack_team_id text,
  connected_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role;

ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_user_connections deny all" ON public.app_user_connections;
CREATE POLICY "app_user_connections deny all"
  ON public.app_user_connections
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);