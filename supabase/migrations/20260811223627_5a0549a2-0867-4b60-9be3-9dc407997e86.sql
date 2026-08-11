CREATE TABLE public.dev_escalations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  intercom_conversation_id text NOT NULL UNIQUE,
  hub_state text NOT NULL DEFAULT 'open',
  linear_url_override text,
  note text,
  owner text,
  state_changed_at timestamptz,
  notified_at timestamptz,
  linear_key text,
  linear_title text,
  linear_state text,
  linear_assignee text,
  linear_synced_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_escalations_hub_state_check CHECK (hub_state IN ('open','in_progress','fix_shipped','customer_notified','wont_do'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dev_escalations TO authenticated;
GRANT ALL ON public.dev_escalations TO service_role;

ALTER TABLE public.dev_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_escalations_select_authenticated"
  ON public.dev_escalations FOR SELECT TO authenticated USING (true);

CREATE POLICY "dev_escalations_insert_authenticated"
  ON public.dev_escalations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "dev_escalations_update_authenticated"
  ON public.dev_escalations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "dev_escalations_delete_admin"
  ON public.dev_escalations FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER dev_escalations_set_updated_at
  BEFORE UPDATE ON public.dev_escalations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_dev_escalations_hub_state ON public.dev_escalations(hub_state);