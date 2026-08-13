CREATE TABLE public.parahelp_routing_sync (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain text NOT NULL,
  account_key text,
  source text NOT NULL DEFAULT 'registry_trigger',
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamp with time zone,
  last_error text,
  pushed_at timestamp with time zone,
  completed_by text,
  completed_at timestamp with time zone,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT parahelp_routing_sync_domain_key UNIQUE (domain),
  CONSTRAINT parahelp_routing_sync_state_chk CHECK (state IN ('pending','pushed','manual_done','failed','skipped'))
);

CREATE INDEX parahelp_routing_sync_state_idx ON public.parahelp_routing_sync (state, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parahelp_routing_sync TO authenticated;
GRANT ALL ON public.parahelp_routing_sync TO service_role;

ALTER TABLE public.parahelp_routing_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parahelp_routing_sync_select" ON public.parahelp_routing_sync
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "parahelp_routing_sync_insert" ON public.parahelp_routing_sync
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "parahelp_routing_sync_update" ON public.parahelp_routing_sync
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "parahelp_routing_sync_delete" ON public.parahelp_routing_sync
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER parahelp_routing_sync_set_updated_at
  BEFORE UPDATE ON public.parahelp_routing_sync
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enqueue newly added domains on customer accounts. Never blocks the registry write:
-- the insert is a plain ON CONFLICT DO NOTHING, and the trigger is AFTER.
CREATE OR REPLACE FUNCTION public.parahelp_enqueue_new_domains()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  new_domains text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_domains := COALESCE(NEW.domains, '{}'::text[]);
  ELSE
    new_domains := ARRAY(
      SELECT d FROM unnest(COALESCE(NEW.domains,'{}'::text[])) d
      WHERE NOT (d = ANY(COALESCE(OLD.domains,'{}'::text[])))
    );
  END IF;

  IF array_length(new_domains, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.parahelp_routing_sync (domain, account_key, source)
  SELECT lower(d), NEW.account_key, 'registry_trigger'
  FROM unnest(new_domains) d
  WHERE d IS NOT NULL AND d <> ''
  ON CONFLICT (domain) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER parahelp_enqueue_new_domains_trg
  AFTER INSERT OR UPDATE ON public.v3_customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.parahelp_enqueue_new_domains();

-- Seed: everything already in the registry is treated as already routed.
INSERT INTO public.parahelp_routing_sync (domain, account_key, source, state, note, completed_at)
SELECT lower(d), a.account_key, 'seed_existing', 'skipped', 'Pre-existing registry domain at queue creation', now()
FROM public.v3_customer_accounts a
CROSS JOIN LATERAL unnest(COALESCE(a.domains,'{}'::text[])) d
WHERE d IS NOT NULL AND d <> ''
ON CONFLICT (domain) DO NOTHING;