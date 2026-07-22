CREATE TABLE public.sla_breach_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_conversation_id text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('first_response','resolution')),
  reason text NOT NULL CHECK (reason IN ('holiday','customer_hold','data_artifact','other')),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intercom_conversation_id, metric)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_breach_overrides TO authenticated;
GRANT ALL ON public.sla_breach_overrides TO service_role;
ALTER TABLE public.sla_breach_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla_breach_overrides readable by authenticated"
  ON public.sla_breach_overrides FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "sla_breach_overrides admin insert"
  ON public.sla_breach_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "sla_breach_overrides admin update"
  ON public.sla_breach_overrides FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "sla_breach_overrides admin delete"
  ON public.sla_breach_overrides FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX sla_breach_overrides_conv_idx ON public.sla_breach_overrides(intercom_conversation_id);