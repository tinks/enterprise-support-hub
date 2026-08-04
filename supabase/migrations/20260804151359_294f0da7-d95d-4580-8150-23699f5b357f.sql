CREATE TABLE public.sla_violation_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  intercom_conversation_id text NOT NULL,
  metric text NOT NULL,
  reason text NOT NULL,
  note text,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sla_violation_overrides_metric_check CHECK (metric = ANY (ARRAY['triage'::text,'first_response'::text,'resolution'::text])),
  CONSTRAINT sla_violation_overrides_reason_check CHECK (reason = ANY (ARRAY['holiday'::text,'off_hours'::text,'customer_hold'::text,'non_support_thread'::text,'recorded_at_close'::text,'answered_before_classified'::text,'data_artifact'::text,'genuine_miss'::text,'other'::text])),
  CONSTRAINT sla_violation_overrides_conv_metric_key UNIQUE (intercom_conversation_id, metric)
);

CREATE INDEX sla_violation_overrides_conv_idx ON public.sla_violation_overrides (intercom_conversation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_violation_overrides TO authenticated;
GRANT ALL ON public.sla_violation_overrides TO service_role;

ALTER TABLE public.sla_violation_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla violation overrides readable by authenticated"
  ON public.sla_violation_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "sla violation overrides insert by authenticated"
  ON public.sla_violation_overrides FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sla violation overrides update by authenticated"
  ON public.sla_violation_overrides FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sla violation overrides admin delete"
  ON public.sla_violation_overrides FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER sla_violation_overrides_set_updated_at
  BEFORE UPDATE ON public.sla_violation_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.sla_violation_overrides (intercom_conversation_id, metric, reason, note, created_by, created_at)
SELECT intercom_conversation_id, metric, reason, note, created_by::text, created_at
FROM public.sla_breach_overrides
ON CONFLICT (intercom_conversation_id, metric) DO NOTHING;