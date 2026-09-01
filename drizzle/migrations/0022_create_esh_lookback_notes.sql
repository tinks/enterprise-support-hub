CREATE TABLE public.esh_lookback_notes (
  month text NOT NULL,
  section_key text NOT NULL,
  note_text text NOT NULL DEFAULT '',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, section_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.esh_lookback_notes TO authenticated;
GRANT ALL ON public.esh_lookback_notes TO service_role;

ALTER TABLE public.esh_lookback_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lookback notes readable by authenticated"
  ON public.esh_lookback_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "lookback notes insert by editors"
  ON public.esh_lookback_notes FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));

CREATE POLICY "lookback notes update by editors"
  ON public.esh_lookback_notes FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

CREATE POLICY "lookback notes delete by editors"
  ON public.esh_lookback_notes FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));