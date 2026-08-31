CREATE TABLE public.intercom_teams (
  team_id text PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.intercom_teams TO authenticated;
GRANT ALL ON public.intercom_teams TO service_role;

ALTER TABLE public.intercom_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read intercom teams"
  ON public.intercom_teams FOR SELECT
  TO authenticated
  USING (true);