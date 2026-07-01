
-- Personal-email allowlist (mirrored in Deno helper) — small, static.
CREATE TABLE public.v3_personal_email_domains (
  domain text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.v3_personal_email_domains TO authenticated;
GRANT ALL ON public.v3_personal_email_domains TO service_role;
ALTER TABLE public.v3_personal_email_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personal_email_domains readable by authenticated"
  ON public.v3_personal_email_domains FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "personal_email_domains admin write"
  ON public.v3_personal_email_domains FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.v3_personal_email_domains (domain) VALUES
  ('gmail.com'), ('googlemail.com'), ('yahoo.com'), ('outlook.com'),
  ('hotmail.com'), ('icloud.com'), ('me.com'), ('mac.com'),
  ('proton.me'), ('protonmail.com'), ('aol.com'), ('live.com'),
  ('msn.com'), ('gmx.com'), ('gmx.de'), ('yandex.com'),
  ('yandex.ru'), ('mail.com'), ('zoho.com'), ('duck.com'),
  ('fastmail.com'), ('tutanota.com'), ('pm.me')
ON CONFLICT DO NOTHING;

-- Customer accounts (domain-to-account mapping)
CREATE TABLE public.v3_customer_accounts (
  account_key text PRIMARY KEY,
  label text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.v3_customer_accounts TO authenticated;
GRANT ALL ON public.v3_customer_accounts TO service_role;
ALTER TABLE public.v3_customer_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_accounts readable by authenticated"
  ON public.v3_customer_accounts FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "customer_accounts admin write"
  ON public.v3_customer_accounts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER v3_customer_accounts_updated_at
  BEFORE UPDATE ON public.v3_customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Domain-collision guard: no domain may appear on two different accounts.
CREATE OR REPLACE FUNCTION public.v3_customer_accounts_check_domain_collision()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  d text;
  other text;
BEGIN
  -- Lowercase & de-dup domains defensively.
  NEW.domains := ARRAY(SELECT DISTINCT lower(x) FROM unnest(coalesce(NEW.domains, '{}'::text[])) x WHERE x IS NOT NULL AND x <> '');
  FOREACH d IN ARRAY NEW.domains LOOP
    SELECT account_key INTO other
      FROM public.v3_customer_accounts
     WHERE account_key <> NEW.account_key
       AND d = ANY(domains)
     LIMIT 1;
    IF other IS NOT NULL THEN
      RAISE EXCEPTION 'Domain % already claimed by account %', d, other;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v3_customer_accounts_domain_collision
  BEFORE INSERT OR UPDATE ON public.v3_customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.v3_customer_accounts_check_domain_collision();

-- Ticket-level customer columns
ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS customer_key text,
  ADD COLUMN IF NOT EXISTS customer_kind text,
  ADD COLUMN IF NOT EXISTS customer_source text,
  ADD COLUMN IF NOT EXISTS customer_override_key text,
  ADD COLUMN IF NOT EXISTS customer_override_by uuid,
  ADD COLUMN IF NOT EXISTS customer_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_override_reason text;

CREATE INDEX IF NOT EXISTS intercom_tickets_v3_customer_key_idx
  ON public.intercom_tickets_v3 (customer_key);

-- ---------------------------------------------------------------------------
-- Customer derivation (ordered rules). MIRRORED in three places:
--   1) supabase/functions/_shared/v3-customer.ts (sync-time)
--   2) this function (DB trigger on intercom_tickets_v3)
--   3) v3_customer_accounts_propagate() (accounts-table propagation)
-- Keep all three in lockstep when rule edits happen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.v3_derive_customer(
  _contact_email text,
  _override_key text
) RETURNS TABLE(customer_key text, customer_kind text, customer_source text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  dom text;
  acct text;
  is_personal boolean;
BEGIN
  -- Rule 1: explicit override
  IF _override_key IS NOT NULL AND _override_key <> '' THEN
    IF _override_key LIKE 'domain:%' THEN
      RETURN QUERY SELECT _override_key, 'domain'::text, 'override'::text;
    ELSIF _override_key = 'unknown' THEN
      RETURN QUERY SELECT 'unknown'::text, 'unknown'::text, 'override'::text;
    ELSE
      RETURN QUERY SELECT _override_key, 'account'::text, 'override'::text;
    END IF;
    RETURN;
  END IF;

  dom := lower(split_part(coalesce(_contact_email, ''), '@', 2));
  IF dom IS NULL OR dom = '' THEN
    RETURN QUERY SELECT 'unknown'::text, 'unknown'::text, 'no_email'::text;
    RETURN;
  END IF;

  -- Rule 2: domain matches a v3_customer_account
  SELECT account_key INTO acct
    FROM public.v3_customer_accounts
   WHERE dom = ANY(domains)
   LIMIT 1;
  IF acct IS NOT NULL THEN
    RETURN QUERY SELECT acct, 'account'::text, 'domain_match'::text;
    RETURN;
  END IF;

  -- Rule 3: personal-email allowlist
  SELECT EXISTS(SELECT 1 FROM public.v3_personal_email_domains WHERE domain = dom) INTO is_personal;
  IF is_personal THEN
    RETURN QUERY SELECT 'domain:_personal'::text, 'personal'::text, 'personal_allowlist'::text;
    RETURN;
  END IF;

  -- Rule 4: generic domain bucket
  RETURN QUERY SELECT ('domain:' || dom)::text, 'domain'::text, 'generic_domain'::text;
END;
$$;

-- Ticket-level trigger: recompute effective customer columns on insert/update.
CREATE OR REPLACE FUNCTION public.intercom_tickets_v3_apply_customer()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.v3_derive_customer(NEW.contact_email, NEW.customer_override_key);
  NEW.customer_key    := r.customer_key;
  NEW.customer_kind   := r.customer_kind;
  NEW.customer_source := r.customer_source;
  RETURN NEW;
END;
$$;

CREATE TRIGGER intercom_tickets_v3_customer_derive
  BEFORE INSERT OR UPDATE OF contact_email, customer_override_key
  ON public.intercom_tickets_v3
  FOR EACH ROW EXECUTE FUNCTION public.intercom_tickets_v3_apply_customer();

-- Accounts-table propagation: when an account's domains change (or it's
-- deleted), recompute customer_key on every affected ticket. Implements its
-- own domain resolution — MUST stay in lockstep with v3_derive_customer above
-- and the Deno resolveV3Customer helper.
CREATE OR REPLACE FUNCTION public.v3_customer_accounts_propagate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  affected text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected := OLD.domains;
  ELSIF TG_OP = 'INSERT' THEN
    affected := NEW.domains;
  ELSE
    affected := ARRAY(SELECT DISTINCT unnest(coalesce(OLD.domains,'{}') || coalesce(NEW.domains,'{}')));
  END IF;

  IF affected IS NULL OR array_length(affected, 1) IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Bump ticket rows whose contact_domain intersects. The BEFORE UPDATE
  -- customer-derive trigger will recompute customer_key/kind/source using the
  -- new accounts table state (lockstep with v3_derive_customer).
  UPDATE public.intercom_tickets_v3
     SET updated_at = now()
   WHERE contact_domain = ANY(affected);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER v3_customer_accounts_propagate_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.v3_customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.v3_customer_accounts_propagate();

-- Backfill function. Idempotent by design; `force` flag re-derives every row
-- (needed after rule/allowlist edits). Batched to 5k for safety.
CREATE OR REPLACE FUNCTION public.backfill_v3_customer_keys(_force boolean DEFAULT false, _batch integer DEFAULT 5000)
RETURNS TABLE(updated_count bigint) LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  total bigint := 0;
  n bigint;
BEGIN
  LOOP
    WITH cte AS (
      SELECT id, contact_email, customer_override_key, customer_key
        FROM public.intercom_tickets_v3
       WHERE _force OR customer_key IS NULL
       LIMIT _batch
    ), derived AS (
      SELECT c.id,
             (SELECT customer_key   FROM public.v3_derive_customer(c.contact_email, c.customer_override_key)) AS nk,
             (SELECT customer_kind   FROM public.v3_derive_customer(c.contact_email, c.customer_override_key)) AS nkind,
             (SELECT customer_source FROM public.v3_derive_customer(c.contact_email, c.customer_override_key)) AS nsrc,
             c.customer_key AS old_key
        FROM cte c
    )
    UPDATE public.intercom_tickets_v3 t
       SET customer_key = d.nk,
           customer_kind = d.nkind,
           customer_source = d.nsrc
      FROM derived d
     WHERE t.id = d.id
       AND (_force OR t.customer_key IS DISTINCT FROM d.nk);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    EXIT WHEN n = 0;
  END LOOP;
  RETURN QUERY SELECT total;
END;
$$;
