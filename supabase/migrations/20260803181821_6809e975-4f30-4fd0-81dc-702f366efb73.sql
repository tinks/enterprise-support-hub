CREATE TABLE public.triage_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_conversation_id text NOT NULL UNIQUE,
  reason text NOT NULL CHECK (reason IN ('off_hours','non_support_thread','recorded_at_close','answered_before_classified','genuine_miss','other')),
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.triage_overrides TO authenticated;
GRANT ALL ON public.triage_overrides TO service_role;

ALTER TABLE public.triage_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "triage overrides readable by authenticated"
  ON public.triage_overrides FOR SELECT TO authenticated USING (true);

CREATE POLICY "triage overrides insert by authenticated"
  ON public.triage_overrides FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "triage overrides update by authenticated"
  ON public.triage_overrides FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "triage overrides admin delete"
  ON public.triage_overrides FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER triage_overrides_set_updated_at
  BEFORE UPDATE ON public.triage_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();