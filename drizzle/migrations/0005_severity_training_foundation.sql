ALTER TABLE public.severity_proposals
  ADD COLUMN IF NOT EXISTS override_reason_code text,
  ADD COLUMN IF NOT EXISTS override_reason_note text,
  ADD COLUMN IF NOT EXISTS input_excerpt text;

CREATE TABLE IF NOT EXISTS public.severity_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text,
  pass text NOT NULL DEFAULT 'triage',
  rubric_version integer,
  model text,
  requested_n integer NOT NULL DEFAULT 0,
  scored_n integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE TABLE IF NOT EXISTS public.severity_eval_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.severity_eval_runs(id) ON DELETE CASCADE,
  intercom_conversation_id text NOT NULL,
  subject text,
  human_severity integer,
  ai_severity integer,
  confidence text,
  rationale text,
  evidence text,
  input_excerpt text,
  error text,
  verdict text NOT NULL DEFAULT 'pending',
  adjudication_note text,
  adjudicated_by uuid,
  adjudicated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, intercom_conversation_id)
);

CREATE INDEX IF NOT EXISTS severity_eval_items_run_idx ON public.severity_eval_items(run_id);
CREATE INDEX IF NOT EXISTS severity_eval_items_verdict_idx ON public.severity_eval_items(verdict);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.severity_eval_runs TO authenticated;
GRANT ALL ON public.severity_eval_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.severity_eval_items TO authenticated;
GRANT ALL ON public.severity_eval_items TO service_role;

ALTER TABLE public.severity_eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.severity_eval_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eval runs readable" ON public.severity_eval_runs;
CREATE POLICY "eval runs readable" ON public.severity_eval_runs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "eval runs writable by editors" ON public.severity_eval_runs;
CREATE POLICY "eval runs writable by editors" ON public.severity_eval_runs
  FOR ALL TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

DROP POLICY IF EXISTS "eval items readable" ON public.severity_eval_items;
CREATE POLICY "eval items readable" ON public.severity_eval_items
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "eval items writable by editors" ON public.severity_eval_items;
CREATE POLICY "eval items writable by editors" ON public.severity_eval_items
  FOR ALL TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

CREATE OR REPLACE FUNCTION public.v3_severity_eval_sample(_n integer DEFAULT 25)
RETURNS TABLE (conversation_id text, human_severity integer, ticket_subject text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.intercom_conversation_id,
         (regexp_match(t.custom_attributes->>'Severity', '[1-4]'))[1]::integer,
         t.subject
  FROM public.intercom_tickets_v3 t
  WHERE t.custom_attributes->>'Severity' IS NOT NULL
    AND t.custom_attributes->>'Severity' ~ '[1-4]'
  ORDER BY random()
  LIMIT GREATEST(1, LEAST(_n, 100));
$$;

GRANT EXECUTE ON FUNCTION public.v3_severity_eval_sample(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.severity_override_reason_rollup(_since timestamptz DEFAULT now() - interval '90 days')
RETURNS TABLE (reason_code text, occurrences bigint, last_seen timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p.override_reason_code, 'unspecified'),
         count(*),
         max(p.decided_at)
  FROM public.severity_proposals p
  WHERE p.status = 'overridden' AND p.decided_at >= _since
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.severity_override_reason_rollup(timestamptz) TO authenticated, service_role;