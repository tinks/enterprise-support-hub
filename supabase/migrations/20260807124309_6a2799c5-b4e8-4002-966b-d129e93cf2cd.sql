ALTER TABLE public.v3_coverage_snapshots
  ADD COLUMN IF NOT EXISTS excluded_transferred_out integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.v3_coverage_current();

CREATE OR REPLACE FUNCTION public.v3_coverage_current()
 RETURNS TABLE(total_tickets integer, population integer, attributed integer, unattributed integer, excluded_not_enterprise integer, excluded_prospect_personal integer, excluded_prospect_unmapped integer, excluded_transferred_out integer, orphan_overrides integer, pct_attributed numeric, m_override integer, m_orphan_override integer, m_slack_channel integer, m_domain integer, m_workspace_id integer, m_unresolved integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH reg AS (SELECT account_key FROM public.v3_customer_accounts),
  all_t AS (SELECT * FROM public.intercom_tickets_v3),
  t AS (SELECT * FROM all_t WHERE lifecycle_status IS DISTINCT FROM 'transferred_out'),
  s AS (
    SELECT
      (SELECT count(*) FROM all_t)::int AS total_tickets,
      (SELECT count(*) FROM all_t WHERE lifecycle_status = 'transferred_out')::int AS excluded_transferred_out,
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
    FROM t
  )
  SELECT
    total_tickets,
    (total_tickets - excluded_transferred_out - excluded_not_enterprise - excluded_prospect_personal - excluded_prospect_unmapped) AS population,
    attributed,
    unattributed,
    excluded_not_enterprise,
    excluded_prospect_personal,
    excluded_prospect_unmapped,
    excluded_transferred_out,
    orphan_overrides,
    CASE WHEN (total_tickets - excluded_transferred_out - excluded_not_enterprise - excluded_prospect_personal - excluded_prospect_unmapped) > 0
      THEN ROUND((attributed::numeric / (total_tickets - excluded_transferred_out - excluded_not_enterprise - excluded_prospect_personal - excluded_prospect_unmapped)::numeric) * 100, 2)
      ELSE 0 END AS pct_attributed,
    m_override, m_orphan_override, m_slack_channel, m_domain, m_workspace_id, m_unresolved
  FROM s;
$function$;

CREATE OR REPLACE FUNCTION public.v3_capture_coverage_snapshot()
 RETURNS v3_coverage_snapshots
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
    excluded_prospect_personal, excluded_prospect_unmapped, excluded_transferred_out
  ) VALUES (
    current_date, c.total_tickets, c.attributed, c.unattributed, c.pct_attributed,
    c.m_override, c.m_slack_channel, c.m_domain, c.m_workspace_id, c.m_unresolved,
    c.m_orphan_override, c.excluded_not_enterprise,
    c.excluded_prospect_personal, c.excluded_prospect_unmapped, c.excluded_transferred_out
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
    excluded_transferred_out = EXCLUDED.excluded_transferred_out,
    updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END;
$function$;