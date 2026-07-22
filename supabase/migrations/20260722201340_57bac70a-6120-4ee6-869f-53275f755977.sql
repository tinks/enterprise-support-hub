
CREATE OR REPLACE FUNCTION public.v3_derive_customer(
  _contact_email text,
  _override_key text,
  _contact_domain text DEFAULT NULL,
  _slack_channel_id_detected text DEFAULT NULL,
  _workspace_id_detected text DEFAULT NULL,
  _tags text[] DEFAULT NULL
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
  IF _tags IS NOT NULL AND 'enterprise-not-enterprise' = ANY(_tags) THEN
    RETURN QUERY SELECT
      'not_enterprise'::text, 'not_enterprise'::text, 'not_enterprise'::text,
      'high'::text, 'not_enterprise'::text;
    RETURN;
  END IF;

  -- Rule 0b: personal-account prospect gate (label-driven, temporal). ABOVE override/account so it
  -- trumps enterprise-prospect and any account signal. Only 'not-enterprise' outranks it.
  IF _tags IS NOT NULL AND 'enterprise-prospect-personal-acct' = ANY(_tags) THEN
    RETURN QUERY SELECT
      'prospect_personal'::text, 'prospect_personal'::text, 'prospect_personal'::text,
      'high'::text, 'prospect_personal'::text;
    RETURN;
  END IF;

  IF _override_key IS NOT NULL AND _override_key <> '' THEN
    RETURN QUERY SELECT
      _override_key,
      CASE
        WHEN _override_key = 'unattributed' OR _override_key = 'unknown' THEN 'unknown'
        WHEN _override_key LIKE 'domain:%' THEN 'domain'
        ELSE 'account'
      END,
      'override'::text, 'high'::text, 'override'::text;
    RETURN;
  END IF;

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

  -- Rule 4b: unmapped-prospect fallback. BELOW account rules so a converted prospect (real account /
  -- mapped workspace) resolves to the account first and this never fires.
  IF _tags IS NOT NULL AND 'enterprise-prospect' = ANY(_tags) THEN
    RETURN QUERY SELECT
      'prospect_unmapped'::text, 'prospect_unmapped'::text, 'enterprise_prospect'::text,
      'medium'::text, 'enterprise_prospect'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'unattributed'::text, 'unknown'::text, 'unresolved'::text, 'unresolved'::text, 'unresolved'::text;
END;
$function$;


ALTER TABLE public.v3_coverage_snapshots
  ADD COLUMN IF NOT EXISTS excluded_prospect_personal integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS excluded_prospect_unmapped integer NOT NULL DEFAULT 0;


DROP FUNCTION IF EXISTS public.v3_coverage_current();
CREATE OR REPLACE FUNCTION public.v3_coverage_current()
RETURNS TABLE(
  total_tickets integer,
  population integer,
  attributed integer,
  unattributed integer,
  excluded_not_enterprise integer,
  excluded_prospect_personal integer,
  excluded_prospect_unmapped integer,
  orphan_overrides integer,
  pct_attributed numeric,
  m_override integer,
  m_orphan_override integer,
  m_slack_channel integer,
  m_domain integer,
  m_workspace_id integer,
  m_unresolved integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH reg AS (SELECT account_key FROM public.v3_customer_accounts),
  s AS (
    SELECT
      count(*)::int AS total_tickets,
      count(*) FILTER (
        WHERE customer_key <> 'unattributed'
          AND customer_key IN (SELECT account_key FROM reg)
      )::int AS attributed,
      count(*) FILTER (WHERE customer_key = 'unattributed')::int AS unattributed,
      count(*) FILTER (WHERE customer_resolution_method = 'not_enterprise')::int AS excluded_not_enterprise,
      count(*) FILTER (WHERE customer_resolution_method = 'prospect_personal')::int AS excluded_prospect_personal,
      count(*) FILTER (WHERE customer_resolution_method = 'enterprise_prospect')::int AS excluded_prospect_unmapped,
      count(*) FILTER (
        WHERE customer_resolution_method = 'override'
          AND customer_key NOT IN (SELECT account_key FROM reg)
      )::int AS orphan_overrides,
      count(*) FILTER (
        WHERE customer_resolution_method = 'override'
          AND customer_key IN (SELECT account_key FROM reg)
      )::int AS m_override,
      count(*) FILTER (
        WHERE customer_resolution_method = 'override'
          AND customer_key NOT IN (SELECT account_key FROM reg)
      )::int AS m_orphan_override,
      count(*) FILTER (
        WHERE customer_resolution_method = 'slack_channel'
          AND customer_key IN (SELECT account_key FROM reg)
      )::int AS m_slack_channel,
      count(*) FILTER (
        WHERE customer_resolution_method = 'domain'
          AND customer_key IN (SELECT account_key FROM reg)
      )::int AS m_domain,
      count(*) FILTER (
        WHERE customer_resolution_method = 'workspace_id'
          AND customer_key IN (SELECT account_key FROM reg)
      )::int AS m_workspace_id,
      count(*) FILTER (
        WHERE customer_resolution_method = 'unresolved' OR customer_resolution_method IS NULL
      )::int AS m_unresolved
    FROM public.intercom_tickets_v3
  )
  SELECT
    total_tickets,
    (total_tickets - excluded_not_enterprise - excluded_prospect_personal - excluded_prospect_unmapped) AS population,
    attributed,
    unattributed,
    excluded_not_enterprise,
    excluded_prospect_personal,
    excluded_prospect_unmapped,
    orphan_overrides,
    CASE WHEN (total_tickets - excluded_not_enterprise - excluded_prospect_personal - excluded_prospect_unmapped) > 0
      THEN ROUND((attributed::numeric / (total_tickets - excluded_not_enterprise - excluded_prospect_personal - excluded_prospect_unmapped)::numeric) * 100, 2)
      ELSE 0 END AS pct_attributed,
    m_override, m_orphan_override, m_slack_channel, m_domain, m_workspace_id, m_unresolved
  FROM s;
$function$;


CREATE OR REPLACE FUNCTION public.v3_capture_coverage_snapshot()
RETURNS public.v3_coverage_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  r public.v3_coverage_snapshots;
BEGIN
  SELECT * INTO c FROM public.v3_coverage_current();
  INSERT INTO public.v3_coverage_snapshots AS s (
    snapshot_date, total_tickets, attributed, unattributed, pct_attributed,
    m_override, m_slack_channel, m_domain, m_workspace_id, m_unresolved,
    m_orphan_override, excluded_not_enterprise,
    excluded_prospect_personal, excluded_prospect_unmapped
  ) VALUES (
    current_date, c.total_tickets, c.attributed, c.unattributed, c.pct_attributed,
    c.m_override, c.m_slack_channel, c.m_domain, c.m_workspace_id, c.m_unresolved,
    c.m_orphan_override, c.excluded_not_enterprise,
    c.excluded_prospect_personal, c.excluded_prospect_unmapped
  )
  ON CONFLICT (snapshot_date) DO UPDATE SET
    total_tickets = EXCLUDED.total_tickets,
    attributed = EXCLUDED.attributed,
    unattributed = EXCLUDED.unattributed,
    pct_attributed = EXCLUDED.pct_attributed,
    m_override = EXCLUDED.m_override,
    m_slack_channel = EXCLUDED.m_slack_channel,
    m_domain = EXCLUDED.m_domain,
    m_workspace_id = EXCLUDED.m_workspace_id,
    m_unresolved = EXCLUDED.m_unresolved,
    m_orphan_override = EXCLUDED.m_orphan_override,
    excluded_not_enterprise = EXCLUDED.excluded_not_enterprise,
    excluded_prospect_personal = EXCLUDED.excluded_prospect_personal,
    excluded_prospect_unmapped = EXCLUDED.excluded_prospect_unmapped,
    updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END;
$function$;
