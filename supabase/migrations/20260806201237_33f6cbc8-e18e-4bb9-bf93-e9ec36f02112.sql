CREATE TABLE public.sla_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional','committed')),
  business_hours jsonb NOT NULL,
  label text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_policy_versions TO authenticated;
GRANT ALL ON public.sla_policy_versions TO service_role;

ALTER TABLE public.sla_policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_policy_versions_select_authenticated" ON public.sla_policy_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "sla_policy_versions_insert_admin" ON public.sla_policy_versions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "sla_policy_versions_update_admin" ON public.sla_policy_versions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "sla_policy_versions_delete_admin" ON public.sla_policy_versions FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER update_sla_policy_versions_updated_at BEFORE UPDATE ON public.sla_policy_versions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.sla_policy_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.sla_policy_versions(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN ('first_response','resolution','cadence','triage')),
  severity int NULL CHECK (severity IN (1,2,3,4)),
  target_seconds int NULL,
  clock text NOT NULL CHECK (clock IN ('business','wall')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, metric, severity)
);

CREATE UNIQUE INDEX sla_policy_targets_triage_unique ON public.sla_policy_targets (version_id, metric) WHERE severity IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_policy_targets TO authenticated;
GRANT ALL ON public.sla_policy_targets TO service_role;

ALTER TABLE public.sla_policy_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_policy_targets_select_authenticated" ON public.sla_policy_targets FOR SELECT TO authenticated USING (true);
CREATE POLICY "sla_policy_targets_insert_admin" ON public.sla_policy_targets FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "sla_policy_targets_update_admin" ON public.sla_policy_targets FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "sla_policy_targets_delete_admin" ON public.sla_policy_targets FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER update_sla_policy_targets_updated_at BEFORE UPDATE ON public.sla_policy_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed: one provisional version reproducing today's engine constants exactly.
WITH v AS (
  INSERT INTO public.sla_policy_versions (effective_from, status, business_hours, label)
  VALUES (
    '2026-01-01T00:00:00Z',
    'provisional',
    '{"tz":"Europe/Berlin","work_days":[1,2,3,4,5],"day_start_hour":9,"day_end_hour":24,"holidays":[],"business_day_seconds":54000}'::jsonb,
    'Seed from code constants (provisional)'
  )
  RETURNING id
)
INSERT INTO public.sla_policy_targets (version_id, metric, severity, target_seconds, clock)
SELECT v.id, t.metric, t.severity, t.target_seconds, t.clock
FROM v, (VALUES
  ('first_response', 1, 1800,   'wall'),
  ('first_response', 2, 14400,  'business'),
  ('first_response', 3, 54000,  'business'),
  ('first_response', 4, 162000, 'business'),
  ('resolution',     1, 28800,  'wall'),
  ('resolution',     2, 108000, 'business'),
  ('resolution',     3, 270000, 'business'),
  ('resolution',     4, NULL,   'business'),
  ('cadence',        1, 3600,   'wall'),
  ('cadence',        2, 14400,  'business'),
  ('cadence',        3, NULL,   'business'),
  ('cadence',        4, NULL,   'business'),
  ('triage',      NULL, 1800,   'business')
) AS t(metric, severity, target_seconds, clock);