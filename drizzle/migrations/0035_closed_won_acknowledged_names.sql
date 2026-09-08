CREATE TABLE public.v3_closed_won_acknowledged_names (
  name_key text PRIMARY KEY,
  display_name text NOT NULL,
  note text,
  acknowledged_by uuid,
  acknowledged_by_email text,
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.v3_closed_won_acknowledged_names TO authenticated;
GRANT ALL ON public.v3_closed_won_acknowledged_names TO service_role;

ALTER TABLE public.v3_closed_won_acknowledged_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read acknowledged closed-won names"
ON public.v3_closed_won_acknowledged_names FOR SELECT TO authenticated USING (true);

CREATE POLICY "Editors can acknowledge closed-won names"
ON public.v3_closed_won_acknowledged_names FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));

CREATE POLICY "Editors can un-acknowledge closed-won names"
ON public.v3_closed_won_acknowledged_names FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
