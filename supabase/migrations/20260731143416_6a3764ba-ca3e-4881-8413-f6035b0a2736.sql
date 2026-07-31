CREATE TABLE public.esh_backlog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('bug','todo','tech_debt','feature_request','strategic')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','done','wontfix')),
  priority text CHECK (priority IS NULL OR priority IN ('high','med','low')),
  area text,
  assignee text,
  linked_ref text,
  source text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.esh_backlog_items TO authenticated;
GRANT ALL ON public.esh_backlog_items TO service_role;

ALTER TABLE public.esh_backlog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backlog readable by authenticated"
  ON public.esh_backlog_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "backlog insert by authenticated"
  ON public.esh_backlog_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "backlog update by authenticated"
  ON public.esh_backlog_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "backlog admin delete"
  ON public.esh_backlog_items FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER esh_backlog_items_set_updated_at
  BEFORE UPDATE ON public.esh_backlog_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();