CREATE TABLE public.relay_attribution_gaps (
  slack_user_id text PRIMARY KEY,
  slack_email text,
  slack_display_name text,
  reason text NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  last_conversation_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

GRANT SELECT, UPDATE ON public.relay_attribution_gaps TO authenticated;
GRANT ALL ON public.relay_attribution_gaps TO service_role;

ALTER TABLE public.relay_attribution_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read relay gaps"
  ON public.relay_attribution_gaps FOR SELECT TO authenticated USING (true);

CREATE POLICY "Editors can resolve relay gaps"
  ON public.relay_attribution_gaps FOR UPDATE TO authenticated
  USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));