
-- 1) v3_internal_channels
CREATE TABLE public.v3_internal_channels (
  slack_channel_id text PRIMARY KEY,
  channel_name text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.v3_internal_channels TO authenticated;
GRANT ALL ON public.v3_internal_channels TO service_role;
ALTER TABLE public.v3_internal_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal_channels readable by authenticated"
  ON public.v3_internal_channels FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "internal_channels admin write"
  ON public.v3_internal_channels FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER v3_internal_channels_updated_at
  BEFORE UPDATE ON public.v3_internal_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.v3_internal_channels (slack_channel_id, channel_name, note)
VALUES ('C0AJ1KPQ084', 'team-enterprise-support', 'Internal enterprise-support triage channel — not a customer');

-- 2) v3_workspace_customer_map
CREATE TABLE public.v3_workspace_customer_map (
  workspace_id text PRIMARY KEY,
  account_key text NOT NULL REFERENCES public.v3_customer_accounts(account_key) ON UPDATE CASCADE ON DELETE RESTRICT,
  workspace_name text,
  tier text,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX v3_workspace_customer_map_account_key_idx
  ON public.v3_workspace_customer_map(account_key);
GRANT SELECT ON public.v3_workspace_customer_map TO authenticated;
GRANT ALL ON public.v3_workspace_customer_map TO service_role;
ALTER TABLE public.v3_workspace_customer_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_customer_map readable by authenticated"
  ON public.v3_workspace_customer_map FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "workspace_customer_map admin write"
  ON public.v3_workspace_customer_map FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER v3_workspace_customer_map_updated_at
  BEFORE UPDATE ON public.v3_workspace_customer_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Raw signal columns on intercom_tickets_v3
ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS slack_channel_id_detected text,
  ADD COLUMN IF NOT EXISTS workspace_id_detected text,
  ADD COLUMN IF NOT EXISTS project_uuid_detected text;

CREATE INDEX IF NOT EXISTS intercom_tickets_v3_slack_channel_detected_idx
  ON public.intercom_tickets_v3(slack_channel_id_detected)
  WHERE slack_channel_id_detected IS NOT NULL;
CREATE INDEX IF NOT EXISTS intercom_tickets_v3_workspace_detected_idx
  ON public.intercom_tickets_v3(workspace_id_detected)
  WHERE workspace_id_detected IS NOT NULL;
CREATE INDEX IF NOT EXISTS intercom_tickets_v3_project_uuid_detected_idx
  ON public.intercom_tickets_v3(project_uuid_detected)
  WHERE project_uuid_detected IS NOT NULL;
