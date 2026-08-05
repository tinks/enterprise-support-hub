ALTER TABLE public.sla_violation_overrides
  DROP CONSTRAINT IF EXISTS sla_violation_overrides_metric_check;

ALTER TABLE public.sla_violation_overrides
  ADD CONSTRAINT sla_violation_overrides_metric_check
  CHECK (metric = ANY (ARRAY['triage'::text,'first_response'::text,'resolution'::text,'cadence'::text]));

DROP POLICY IF EXISTS "sla_violation_overrides insert by authenticated" ON public.sla_violation_overrides;
DROP POLICY IF EXISTS "sla_violation_overrides update by authenticated" ON public.sla_violation_overrides;

CREATE POLICY "sla_violation_overrides admin insert"
  ON public.sla_violation_overrides FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "sla_violation_overrides admin update"
  ON public.sla_violation_overrides FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TABLE IF EXISTS public.triage_overrides;