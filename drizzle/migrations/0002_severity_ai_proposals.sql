-- AI severity proposals (1–4): editable versioned rubric + proposal ledger.
-- The AI never writes Intercom; a proposal is a suggestion a human accepts or overrides.

CREATE TABLE public.severity_rubric_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  label text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT severity_rubric_versions_version_key UNIQUE (version),
  CONSTRAINT severity_rubric_versions_status_chk CHECK (status IN ('draft','active','retired'))
);

-- Exactly one active rubric at a time.
CREATE UNIQUE INDEX severity_rubric_one_active
  ON public.severity_rubric_versions ((status)) WHERE status = 'active';

GRANT SELECT ON public.severity_rubric_versions TO authenticated;
GRANT ALL ON public.severity_rubric_versions TO service_role;
ALTER TABLE public.severity_rubric_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rubric readable by authenticated"
  ON public.severity_rubric_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "rubric insert by admin"
  ON public.severity_rubric_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rubric update by admin"
  ON public.severity_rubric_versions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rubric delete by admin"
  ON public.severity_rubric_versions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER severity_rubric_versions_set_updated_at
  BEFORE UPDATE ON public.severity_rubric_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.severity_rubric_versions (version, body, status, label)
VALUES (
  1,
  E'PLACEHOLDER RUBRIC — replace with the real severity framework.\n\nSeverity 1 (Critical): production is down or unusable for an enterprise customer, no workaround, revenue/security impact.\nSeverity 2 (High): major feature broken or severely degraded for many users; painful workaround only.\nSeverity 3 (Medium): a feature misbehaves for some users; a reasonable workaround exists.\nSeverity 4 (Trivial): question, cosmetic issue, feature request, or informational request with no operational impact.',
  'active',
  'placeholder seed'
);

CREATE TABLE public.severity_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_conversation_id text NOT NULL,
  pass text NOT NULL,
  proposed_severity smallint NOT NULL,
  confidence text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  evidence text,
  rubric_version integer,
  model text,
  input_chars integer,
  input_tokens integer,
  output_tokens integer,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  final_severity smallint,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT severity_proposals_pass_chk CHECK (pass IN ('triage','reclassify')),
  CONSTRAINT severity_proposals_sev_chk CHECK (proposed_severity BETWEEN 1 AND 4),
  CONSTRAINT severity_proposals_final_chk CHECK (final_severity IS NULL OR final_severity BETWEEN 1 AND 4),
  CONSTRAINT severity_proposals_conf_chk CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT severity_proposals_status_chk CHECK (status IN ('proposed','accepted','overridden','superseded')),
  CONSTRAINT severity_proposals_hash_key UNIQUE (intercom_conversation_id, content_hash)
);

CREATE INDEX severity_proposals_conv_idx
  ON public.severity_proposals (intercom_conversation_id, created_at DESC);
CREATE INDEX severity_proposals_status_idx
  ON public.severity_proposals (status, created_at DESC);

GRANT SELECT, UPDATE ON public.severity_proposals TO authenticated;
GRANT ALL ON public.severity_proposals TO service_role;
ALTER TABLE public.severity_proposals ENABLE ROW LEVEL SECURITY;

-- Reads are open to any signed-in Hub member; the only client-side write is the
-- human decision (accept / override), which requires the editor role. Inserts
-- come exclusively from the edge function via service_role.
CREATE POLICY "severity proposals readable by authenticated"
  ON public.severity_proposals FOR SELECT TO authenticated USING (true);
CREATE POLICY "severity proposal decisions by editors"
  ON public.severity_proposals FOR UPDATE TO authenticated
  USING (public.can_edit(auth.uid()))
  WITH CHECK (public.can_edit(auth.uid()));

CREATE TRIGGER severity_proposals_set_updated_at
  BEFORE UPDATE ON public.severity_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS severity_ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS severity_ai_daily_call_cap integer NOT NULL DEFAULT 200;
