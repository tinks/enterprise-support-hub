ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS csat_rater_contact_id text,
  ADD COLUMN IF NOT EXISTS csat_rater_external_id text,
  ADD COLUMN IF NOT EXISTS csat_rater_name text,
  ADD COLUMN IF NOT EXISTS csat_rater_email text,
  ADD COLUMN IF NOT EXISTS csat_rater_is_internal boolean;

CREATE OR REPLACE FUNCTION public.v3_apply_csat_rater()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cr jsonb;
  ext text;
  slack_id text;
BEGIN
  cr := NEW.raw_payload -> 'conversation_rating';

  IF cr IS NULL OR cr->>'rating' IS NULL THEN
    NEW.csat_rater_contact_id := NULL;
    NEW.csat_rater_external_id := NULL;
    NEW.csat_rater_name := NULL;
    NEW.csat_rater_email := NULL;
    NEW.csat_rater_is_internal := NULL;
    RETURN NEW;
  END IF;

  ext := cr #>> '{contact,external_id}';
  NEW.csat_rater_contact_id := cr #>> '{contact,id}';
  NEW.csat_rater_external_id := ext;
  NEW.csat_rater_name := NEW.contact_name;
  NEW.csat_rater_email := NEW.contact_email;

  slack_id := CASE WHEN ext LIKE 'slack:%' THEN split_part(ext, ':', 2) ELSE NULL END;

  NEW.csat_rater_is_internal :=
    (NEW.contact_email IS NOT NULL AND lower(NEW.contact_email) LIKE '%@lovable.dev')
    OR (slack_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.teammates t WHERE t.slack_user_id = slack_id
        ))
    OR (NEW.contact_email IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.teammates t WHERE lower(t.email) = lower(NEW.contact_email)
        ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_v3_apply_csat_rater ON public.intercom_tickets_v3;
CREATE TRIGGER trg_v3_apply_csat_rater
BEFORE INSERT OR UPDATE OF raw_payload, csat_rating, contact_email, contact_name
ON public.intercom_tickets_v3
FOR EACH ROW EXECUTE FUNCTION public.v3_apply_csat_rater();

CREATE TABLE IF NOT EXISTS public.csat_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.intercom_tickets_v3(id) ON DELETE CASCADE,
  intercom_conversation_id text,
  original_rating integer,
  action text NOT NULL DEFAULT 'exclude' CHECK (action IN ('exclude')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  created_by uuid DEFAULT auth.uid(),
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.csat_overrides TO authenticated;
GRANT ALL ON public.csat_overrides TO service_role;

ALTER TABLE public.csat_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csat_overrides_select" ON public.csat_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "csat_overrides_insert" ON public.csat_overrides
  FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
CREATE POLICY "csat_overrides_update" ON public.csat_overrides
  FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));
CREATE POLICY "csat_overrides_delete" ON public.csat_overrides
  FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_csat_overrides_ticket ON public.csat_overrides(ticket_id);
