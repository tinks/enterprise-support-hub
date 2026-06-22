
CREATE TABLE public.changelog_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date date NOT NULL DEFAULT current_date,
  title text NOT NULL,
  body text,
  tags text[] NOT NULL DEFAULT '{}',
  area text,
  author_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.changelog_entries TO authenticated;
GRANT ALL ON public.changelog_entries TO service_role;

ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read changelog"
  ON public.changelog_entries FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert changelog"
  ON public.changelog_entries FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update changelog"
  ON public.changelog_entries FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can delete changelog"
  ON public.changelog_entries FOR DELETE
  TO authenticated
  USING (true);

CREATE INDEX changelog_entries_date_idx
  ON public.changelog_entries (entry_date DESC, created_at DESC);

CREATE TRIGGER update_changelog_entries_updated_at
  BEFORE UPDATE ON public.changelog_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
