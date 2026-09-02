-- Multi-Linear escalations: one conversation may be escalated as several Linear
-- issues. public.dev_escalations stays the Hub DECISION row (one per
-- conversation, hub_state/note/owner/override); this child table holds the
-- read-only Linear mirror for EVERY referenced issue, so the engineering-wait
-- clock can union their windows instead of seeing only the first key.
CREATE TABLE IF NOT EXISTS public.dev_escalation_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  intercom_conversation_id text NOT NULL,
  linear_key text NOT NULL,
  linear_title text,
  linear_state text,
  linear_state_type text,
  linear_assignee text,
  linear_url text,
  linear_created_at timestamptz,
  linear_started_at timestamptz,
  linear_completed_at timestamptz,
  linear_canceled_at timestamptz,
  linear_synced_at timestamptz,
  source text NOT NULL DEFAULT 'attribute',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_escalation_links_unique UNIQUE (intercom_conversation_id, linear_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dev_escalation_links TO authenticated;
GRANT ALL ON public.dev_escalation_links TO service_role;

ALTER TABLE public.dev_escalation_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_escalation_links_select_authenticated"
  ON public.dev_escalation_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "dev_escalation_links_insert_editor"
  ON public.dev_escalation_links FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
CREATE POLICY "dev_escalation_links_update_editor"
  ON public.dev_escalation_links FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));
CREATE POLICY "dev_escalation_links_delete_admin"
  ON public.dev_escalation_links FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER dev_escalation_links_set_updated_at
  BEFORE UPDATE ON public.dev_escalation_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_dev_escalation_links_conv
  ON public.dev_escalation_links(intercom_conversation_id);

COMMENT ON TABLE public.dev_escalation_links IS
  'Read-only Linear mirror, one row per (conversation, Linear issue). Engineering wait unions the per-issue windows. Hub-owned decisions stay on dev_escalations.';
