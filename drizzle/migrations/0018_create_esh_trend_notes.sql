CREATE TABLE public.esh_trend_notes (
  metric_key text PRIMARY KEY,
  note_text text NOT NULL DEFAULT '',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.esh_trend_notes TO authenticated;
GRANT ALL ON public.esh_trend_notes TO service_role;

ALTER TABLE public.esh_trend_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read trend notes"
  ON public.esh_trend_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Editors can insert trend notes"
  ON public.esh_trend_notes FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));

CREATE POLICY "Editors can update trend notes"
  ON public.esh_trend_notes FOR UPDATE TO authenticated
  USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

CREATE POLICY "Editors can delete trend notes"
  ON public.esh_trend_notes FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
