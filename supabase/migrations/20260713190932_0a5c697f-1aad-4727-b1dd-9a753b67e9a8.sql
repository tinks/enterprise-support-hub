
-- =========================================================================
-- Phase 2b — v3 customer resolver (LOCKSTEP)
-- =========================================================================

-- New authoritative derive function.
-- Inputs: contact_email, contact_domain, customer_override_key,
--         slack_channel_id_detected, workspace_id_detected
-- Output: customer_key, customer_kind, customer_source, customer_confidence,
--         customer_resolution_method
--
-- Rule order (first match wins):
--  1. override
--  2. slack_channel_id_detected present AND not internal AND mapped -> account
--  3. contact_email domain in v3_customer_accounts.domains AND not internal
--     (lovable.dev) AND not personal -> account
--  4. workspace_id_detected mapped -> account (medium confidence)
--  5. unattributed / unresolved
CREATE OR REPLACE FUNCTION public.v3_derive_customer(
  _contact_email text,
  _override_key text,
  _contact_domain text DEFAULT NULL,
  _slack_channel_id_detected text DEFAULT NULL,
  _workspace_id_detected text DEFAULT NULL
)
RETURNS TABLE(
  customer_key text,
  customer_kind text,
  customer_source text,
  customer_confidence text,
  customer_resolution_method text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  dom text;
  acct text;
  is_internal_channel boolean;
  is_personal boolean;
BEGIN
  -- Rule 1: explicit override (stored as-is; no validation here)
  IF _override_key IS NOT NULL AND _override_key <> '' THEN
    RETURN QUERY SELECT
      _override_key,
      CASE
        WHEN _override_key = 'unattributed' OR _override_key = 'unknown' THEN 'unknown'
        WHEN _override_key LIKE 'domain:%' THEN 'domain'
        ELSE 'account'
      END,
      'override'::text,
      'high'::text,
      'override'::text;
    RETURN;
  END IF;

  -- Rule 2: Slack channel signal (non-internal, mapped)
  IF _slack_channel_id_detected IS NOT NULL AND _slack_channel_id_detected <> '' THEN
    SELECT EXISTS(SELECT 1 FROM public.v3_internal_channels WHERE slack_channel_id = _slack_channel_id_detected)
      INTO is_internal_channel;
    IF NOT is_internal_channel THEN
      SELECT account_key INTO acct
        FROM public.v3_channel_account_map
       WHERE slack_channel_id = _slack_channel_id_detected
       LIMIT 1;
      IF acct IS NOT NULL THEN
        RETURN QUERY SELECT acct, 'account'::text, 'slack_channel'::text, 'high'::text, 'slack_channel'::text;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Rule 3: contact email domain in customer_accounts (excluding internal + personal)
  dom := COALESCE(NULLIF(lower(_contact_domain), ''), lower(split_part(coalesce(_contact_email, ''), '@', 2)));
  IF dom IS NOT NULL AND dom <> '' AND dom <> 'lovable.dev' THEN
    SELECT EXISTS(SELECT 1 FROM public.v3_personal_email_domains WHERE domain = dom) INTO is_personal;
    IF NOT is_personal THEN
      SELECT account_key INTO acct
        FROM public.v3_customer_accounts
       WHERE dom = ANY(domains)
       LIMIT 1;
      IF acct IS NOT NULL THEN
        RETURN QUERY SELECT acct, 'account'::text, 'domain'::text, 'high'::text, 'domain'::text;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Rule 4: workspace_id signal (medium confidence)
  IF _workspace_id_detected IS NOT NULL AND _workspace_id_detected <> '' THEN
    SELECT account_key INTO acct
      FROM public.v3_workspace_customer_map
     WHERE workspace_id = _workspace_id_detected
     LIMIT 1;
    IF acct IS NOT NULL THEN
      RETURN QUERY SELECT acct, 'account'::text, 'workspace_id'::text, 'medium'::text, 'workspace_id'::text;
      RETURN;
    END IF;
  END IF;

  -- Rule 5: unresolved
  RETURN QUERY SELECT 'unattributed'::text, 'unknown'::text, 'unresolved'::text, 'unresolved'::text, 'unresolved'::text;
END;
$function$;


-- Ticket BEFORE INSERT/UPDATE trigger function — now writes method + confidence.
CREATE OR REPLACE FUNCTION public.intercom_tickets_v3_apply_customer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.v3_derive_customer(
    NEW.contact_email,
    NEW.customer_override_key,
    NEW.contact_domain,
    NEW.slack_channel_id_detected,
    NEW.workspace_id_detected
  );
  NEW.customer_key                := r.customer_key;
  NEW.customer_kind               := r.customer_kind;
  NEW.customer_source             := r.customer_source;
  NEW.customer_confidence         := r.customer_confidence;
  NEW.customer_resolution_method  := r.customer_resolution_method;
  RETURN NEW;
END;
$function$;

-- Broaden the trigger so ANY update re-derives (needed for lookup-table propagation).
DROP TRIGGER IF EXISTS intercom_tickets_v3_customer_derive ON public.intercom_tickets_v3;
CREATE TRIGGER intercom_tickets_v3_customer_derive
BEFORE INSERT OR UPDATE ON public.intercom_tickets_v3
FOR EACH ROW EXECUTE FUNCTION public.intercom_tickets_v3_apply_customer();


-- =========================================================================
-- Propagation triggers on lookup tables
-- =========================================================================

-- Customer accounts: unchanged behavior; touch tickets whose contact_domain
-- intersects added/removed domains OR whose customer_key = affected account_key.
CREATE OR REPLACE FUNCTION public.v3_customer_accounts_propagate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  affected_domains text[];
  affected_keys text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_domains := OLD.domains;
    affected_keys    := ARRAY[OLD.account_key];
  ELSIF TG_OP = 'INSERT' THEN
    affected_domains := NEW.domains;
    affected_keys    := ARRAY[NEW.account_key];
  ELSE
    affected_domains := ARRAY(SELECT DISTINCT unnest(coalesce(OLD.domains,'{}') || coalesce(NEW.domains,'{}')));
    affected_keys    := ARRAY(SELECT DISTINCT unnest(ARRAY[OLD.account_key, NEW.account_key]));
  END IF;

  UPDATE public.intercom_tickets_v3
     SET updated_at = now()
   WHERE (affected_domains IS NOT NULL AND array_length(affected_domains,1) IS NOT NULL AND contact_domain = ANY(affected_domains))
      OR (affected_keys IS NOT NULL AND array_length(affected_keys,1) IS NOT NULL AND customer_key = ANY(affected_keys));

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Workspace map propagate
CREATE OR REPLACE FUNCTION public.v3_workspace_customer_map_propagate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  ws text[];
  keys text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    ws := ARRAY[OLD.workspace_id]; keys := ARRAY[OLD.account_key];
  ELSIF TG_OP = 'INSERT' THEN
    ws := ARRAY[NEW.workspace_id]; keys := ARRAY[NEW.account_key];
  ELSE
    ws := ARRAY(SELECT DISTINCT unnest(ARRAY[OLD.workspace_id, NEW.workspace_id]));
    keys := ARRAY(SELECT DISTINCT unnest(ARRAY[OLD.account_key, NEW.account_key]));
  END IF;

  UPDATE public.intercom_tickets_v3
     SET updated_at = now()
   WHERE workspace_id_detected = ANY(ws)
      OR customer_key = ANY(keys);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS v3_workspace_customer_map_propagate_trg ON public.v3_workspace_customer_map;
CREATE TRIGGER v3_workspace_customer_map_propagate_trg
AFTER INSERT OR UPDATE OR DELETE ON public.v3_workspace_customer_map
FOR EACH ROW EXECUTE FUNCTION public.v3_workspace_customer_map_propagate();

-- Channel account map propagate
CREATE OR REPLACE FUNCTION public.v3_channel_account_map_propagate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  chans text[];
  keys text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    chans := ARRAY[OLD.slack_channel_id]; keys := ARRAY[OLD.account_key];
  ELSIF TG_OP = 'INSERT' THEN
    chans := ARRAY[NEW.slack_channel_id]; keys := ARRAY[NEW.account_key];
  ELSE
    chans := ARRAY(SELECT DISTINCT unnest(ARRAY[OLD.slack_channel_id, NEW.slack_channel_id]));
    keys := ARRAY(SELECT DISTINCT unnest(ARRAY[OLD.account_key, NEW.account_key]));
  END IF;

  UPDATE public.intercom_tickets_v3
     SET updated_at = now()
   WHERE slack_channel_id_detected = ANY(chans)
      OR customer_key = ANY(keys);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS v3_channel_account_map_propagate_trg ON public.v3_channel_account_map;
CREATE TRIGGER v3_channel_account_map_propagate_trg
AFTER INSERT OR UPDATE OR DELETE ON public.v3_channel_account_map
FOR EACH ROW EXECUTE FUNCTION public.v3_channel_account_map_propagate();

-- Internal channels propagate (adding/removing internal status flips resolution)
CREATE OR REPLACE FUNCTION public.v3_internal_channels_propagate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  chans text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    chans := ARRAY[OLD.slack_channel_id];
  ELSIF TG_OP = 'INSERT' THEN
    chans := ARRAY[NEW.slack_channel_id];
  ELSE
    chans := ARRAY(SELECT DISTINCT unnest(ARRAY[OLD.slack_channel_id, NEW.slack_channel_id]));
  END IF;

  UPDATE public.intercom_tickets_v3
     SET updated_at = now()
   WHERE slack_channel_id_detected = ANY(chans);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS v3_internal_channels_propagate_trg ON public.v3_internal_channels;
CREATE TRIGGER v3_internal_channels_propagate_trg
AFTER INSERT OR UPDATE OR DELETE ON public.v3_internal_channels
FOR EACH ROW EXECUTE FUNCTION public.v3_internal_channels_propagate();


-- Refresh the backfill helper to use the new derive signature.
CREATE OR REPLACE FUNCTION public.backfill_v3_customer_keys(_force boolean DEFAULT false, _batch integer DEFAULT 5000)
RETURNS TABLE(updated_count bigint)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  total bigint := 0;
  n bigint;
BEGIN
  LOOP
    WITH cte AS (
      SELECT id, contact_email, contact_domain, customer_override_key,
             slack_channel_id_detected, workspace_id_detected, customer_key
        FROM public.intercom_tickets_v3
       WHERE _force OR customer_key IS NULL OR customer_resolution_method IS NULL
       LIMIT _batch
    ), derived AS (
      SELECT c.id,
             d.customer_key AS nk,
             d.customer_kind AS nkind,
             d.customer_source AS nsrc,
             d.customer_confidence AS nconf,
             d.customer_resolution_method AS nmethod,
             c.customer_key AS old_key
        FROM cte c
        CROSS JOIN LATERAL public.v3_derive_customer(
          c.contact_email, c.customer_override_key, c.contact_domain,
          c.slack_channel_id_detected, c.workspace_id_detected
        ) d
    )
    UPDATE public.intercom_tickets_v3 t
       SET customer_key = d.nk,
           customer_kind = d.nkind,
           customer_source = d.nsrc,
           customer_confidence = d.nconf,
           customer_resolution_method = d.nmethod
      FROM derived d
     WHERE t.id = d.id
       AND (_force
            OR t.customer_key IS DISTINCT FROM d.nk
            OR t.customer_resolution_method IS DISTINCT FROM d.nmethod);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    EXIT WHEN n = 0;
  END LOOP;
  RETURN QUERY SELECT total;
END;
$function$;
