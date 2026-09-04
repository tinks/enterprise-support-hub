-- Performance only. Output of both functions is byte-identical to the previous
-- definitions (verified by row-level EXCEPT/row() comparison before applying).
--
-- v3_coverage_current: the old body opened with `all_t AS (SELECT * FROM
-- intercom_tickets_v3)`, which materialised every column (including the large
-- raw_payload jsonb, width=2147) and was then re-scanned by ~14 FILTER
-- aggregates, each of which also re-scanned the registry CTE. Mean 2.28s.
-- New body scans the three columns it needs once and resolves registry
-- membership into a single boolean per row.
CREATE OR REPLACE FUNCTION public.v3_coverage_current()
 RETURNS TABLE(total_tickets integer, population integer, attributed integer, unattributed integer, excluded_not_enterprise integer, excluded_prospect_personal integer, excluded_prospect_unmapped integer, excluded_transferred_out integer, orphan_overrides integer, pct_attributed numeric, m_override integer, m_orphan_override integer, m_slack_channel integer, m_domain integer, m_workspace_id integer, m_unresolved integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      customer_key,
      customer_resolution_method,
      (lifecycle_status IS DISTINCT FROM 'transferred_out') AS keep,
      (lifecycle_status = 'transferred_out') AS xout,
      (customer_key IN (SELECT account_key FROM public.v3_customer_accounts)) AS in_reg
    FROM public.intercom_tickets_v3
  ),
  s AS (
    SELECT
      count(*)::int AS total_tickets,
      count(*) FILTER (WHERE xout)::int AS excluded_transferred_out,
      count(*) FILTER (WHERE keep AND customer_key <> 'unattributed' AND in_reg)::int AS attributed,
      count(*) FILTER (WHERE keep AND customer_key = 'unattributed')::int AS unattributed,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'not_enterprise')::int AS excluded_not_enterprise,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'prospect_personal')::int AS excluded_prospect_personal,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'enterprise_prospect')::int AS excluded_prospect_unmapped,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'override' AND NOT in_reg)::int AS orphan_overrides,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'override' AND in_reg)::int AS m_override,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'override' AND NOT in_reg)::int AS m_orphan_override,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'slack_channel' AND in_reg)::int AS m_slack_channel,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'domain' AND in_reg)::int AS m_domain,
      count(*) FILTER (WHERE keep AND customer_resolution_method = 'workspace_id' AND in_reg)::int AS m_workspace_id,
      count(*) FILTER (WHERE keep AND (customer_resolution_method = 'unresolved' OR customer_resolution_method IS NULL))::int AS m_unresolved
    FROM base
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

-- v3_unattributed_groups: the old body evaluated the identical chain of
-- NOT EXISTS probes TWICE per row (once for group_kind, once for group_key).
-- Classification is now computed once and group_key derived from it.
CREATE OR REPLACE FUNCTION public.v3_unattributed_groups()
 RETURNS TABLE(group_kind text, group_key text, display_name text, ticket_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH un AS (
    SELECT t.id, t.contact_domain, t.slack_channel_id_detected, t.workspace_id_detected
    FROM public.intercom_tickets_v3 t
    WHERE t.customer_key = 'unattributed'
      AND t.lifecycle_status <> 'transferred_out'
  ),
  flags AS (
    SELECT
      un.*,
      (un.contact_domain IS NOT NULL AND un.contact_domain <> '' AND un.contact_domain <> 'lovable.dev'
        AND NOT EXISTS (SELECT 1 FROM public.v3_customer_accounts a WHERE un.contact_domain = ANY(a.domains))
        AND NOT EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
      ) AS is_domain,
      (un.slack_channel_id_detected IS NOT NULL AND un.slack_channel_id_detected <> ''
        AND NOT EXISTS (SELECT 1 FROM public.v3_internal_channels i WHERE i.slack_channel_id = un.slack_channel_id_detected)
        AND NOT EXISTS (SELECT 1 FROM public.v3_channel_account_map cm WHERE cm.slack_channel_id = un.slack_channel_id_detected)
      ) AS is_channel,
      (un.workspace_id_detected IS NOT NULL AND un.workspace_id_detected <> ''
        AND NOT EXISTS (SELECT 1 FROM public.v3_workspace_customer_map wm WHERE wm.workspace_id = un.workspace_id_detected)
      ) AS is_workspace,
      (un.contact_domain IS NOT NULL AND un.contact_domain <> ''
        AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
      ) AS is_personal
    FROM un
  ),
  classified AS (
    SELECT
      f.id,
      CASE
        WHEN f.is_domain THEN 'domain'
        WHEN f.is_channel THEN 'channel'
        WHEN f.is_workspace THEN 'workspace'
        WHEN f.is_personal THEN 'personal_unlabeled'
        ELSE 'no_signal'
      END AS group_kind,
      CASE
        WHEN f.is_domain THEN f.contact_domain
        WHEN f.is_channel THEN f.slack_channel_id_detected
        WHEN f.is_workspace THEN f.workspace_id_detected
        ELSE ''
      END AS group_key
    FROM flags f
  )
  SELECT
    c.group_kind,
    c.group_key,
    CASE
      WHEN c.group_kind='channel' THEN cn.channel_name
      WHEN c.group_kind='personal_unlabeled' THEN 'Likely personal — needs label'
      ELSE NULL
    END AS display_name,
    count(*)::int AS ticket_count
  FROM classified c
  LEFT JOIN public.v3_channel_names cn
    ON c.group_kind='channel' AND cn.slack_channel_id = c.group_key
  GROUP BY c.group_kind, c.group_key, cn.channel_name
  ORDER BY ticket_count DESC, c.group_kind, c.group_key;
$function$;