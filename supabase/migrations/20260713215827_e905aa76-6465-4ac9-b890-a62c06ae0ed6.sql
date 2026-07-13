
-- 1) Snapshots: add orphan-override column
ALTER TABLE public.v3_coverage_snapshots
  ADD COLUMN IF NOT EXISTS m_orphan_override integer NOT NULL DEFAULT 0;

-- 2) Redefine v3_coverage_current with verified attribution + orphan count
DROP FUNCTION IF EXISTS public.v3_coverage_current();
CREATE OR REPLACE FUNCTION public.v3_coverage_current()
RETURNS TABLE(
  total_tickets integer,
  attributed integer,
  unattributed integer,
  orphan_overrides integer,
  pct_attributed numeric,
  m_override integer,
  m_orphan_override integer,
  m_slack_channel integer,
  m_domain integer,
  m_workspace_id integer,
  m_unresolved integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH reg AS (SELECT account_key FROM public.v3_customer_accounts),
  s AS (
    SELECT
      count(*)::int AS total_tickets,
      count(*) FILTER (
        WHERE customer_key <> 'unattributed'
          AND customer_key IN (SELECT account_key FROM reg)
      )::int AS attributed,
      count(*) FILTER (WHERE customer_key = 'unattributed')::int AS unattributed,
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
    total_tickets, attributed, unattributed, orphan_overrides,
    CASE WHEN total_tickets > 0
      THEN ROUND((attributed::numeric / total_tickets::numeric) * 100, 2)
      ELSE 0 END AS pct_attributed,
    m_override, m_orphan_override, m_slack_channel, m_domain, m_workspace_id, m_unresolved
  FROM s;
$$;

-- 3) Update snapshot capture
CREATE OR REPLACE FUNCTION public.v3_capture_coverage_snapshot()
RETURNS public.v3_coverage_snapshots
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  c record;
  r public.v3_coverage_snapshots;
BEGIN
  SELECT * INTO c FROM public.v3_coverage_current();
  INSERT INTO public.v3_coverage_snapshots AS s (
    snapshot_date, total_tickets, attributed, unattributed, pct_attributed,
    m_override, m_slack_channel, m_domain, m_workspace_id, m_unresolved, m_orphan_override
  ) VALUES (
    current_date, c.total_tickets, c.attributed, c.unattributed, c.pct_attributed,
    c.m_override, c.m_slack_channel, c.m_domain, c.m_workspace_id, c.m_unresolved, c.m_orphan_override
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
    updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- 4) Re-capture today's snapshot with verified coverage
SELECT public.v3_capture_coverage_snapshot();

-- 5) Channel-name lookup helper (most-common name per slack_channel_id via ticket attrs)
CREATE OR REPLACE VIEW public.v3_channel_names AS
WITH pairs AS (
  SELECT t.slack_channel_id_detected AS slack_channel_id,
         NULLIF(regexp_replace(a.attr_value_text, '^#', ''), '') AS channel_name,
         count(*) AS n
  FROM public.intercom_tickets_v3 t
  JOIN public.v3_ticket_attributes a
    ON a.ticket_id = t.id AND a.attr_key = 'Slack channel'
  WHERE t.slack_channel_id_detected IS NOT NULL
    AND a.attr_value_text IS NOT NULL
    AND a.attr_value_text <> ''
  GROUP BY t.slack_channel_id_detected, channel_name
),
ranked AS (
  SELECT slack_channel_id, channel_name,
         row_number() OVER (PARTITION BY slack_channel_id ORDER BY n DESC, channel_name) AS rn
  FROM pairs
)
SELECT slack_channel_id, channel_name FROM ranked WHERE rn = 1;

GRANT SELECT ON public.v3_channel_names TO authenticated;

-- 6) Update v3_unattributed_groups to include display_name (channel name for channel groups)
DROP FUNCTION IF EXISTS public.v3_unattributed_groups();
CREATE OR REPLACE FUNCTION public.v3_unattributed_groups()
RETURNS TABLE(group_kind text, group_key text, display_name text, ticket_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH un AS (
    SELECT t.id, t.contact_domain, t.slack_channel_id_detected, t.workspace_id_detected
    FROM public.intercom_tickets_v3 t
    WHERE t.customer_key = 'unattributed'
  ),
  classified AS (
    SELECT
      un.id,
      CASE
        WHEN un.contact_domain IS NOT NULL
          AND un.contact_domain <> ''
          AND un.contact_domain <> 'lovable.dev'
          AND NOT EXISTS (SELECT 1 FROM public.v3_customer_accounts a WHERE un.contact_domain = ANY(a.domains))
          AND NOT EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
          THEN 'domain'
        WHEN un.slack_channel_id_detected IS NOT NULL
          AND un.slack_channel_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_internal_channels i WHERE i.slack_channel_id = un.slack_channel_id_detected)
          AND NOT EXISTS (SELECT 1 FROM public.v3_channel_account_map cm WHERE cm.slack_channel_id = un.slack_channel_id_detected)
          THEN 'channel'
        WHEN un.workspace_id_detected IS NOT NULL
          AND un.workspace_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_workspace_customer_map wm WHERE wm.workspace_id = un.workspace_id_detected)
          THEN 'workspace'
        ELSE 'no_signal'
      END AS group_kind,
      CASE
        WHEN un.contact_domain IS NOT NULL
          AND un.contact_domain <> ''
          AND un.contact_domain <> 'lovable.dev'
          AND NOT EXISTS (SELECT 1 FROM public.v3_customer_accounts a WHERE un.contact_domain = ANY(a.domains))
          AND NOT EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
          THEN un.contact_domain
        WHEN un.slack_channel_id_detected IS NOT NULL
          AND un.slack_channel_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_internal_channels i WHERE i.slack_channel_id = un.slack_channel_id_detected)
          AND NOT EXISTS (SELECT 1 FROM public.v3_channel_account_map cm WHERE cm.slack_channel_id = un.slack_channel_id_detected)
          THEN un.slack_channel_id_detected
        WHEN un.workspace_id_detected IS NOT NULL
          AND un.workspace_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_workspace_customer_map wm WHERE wm.workspace_id = un.workspace_id_detected)
          THEN un.workspace_id_detected
        ELSE ''
      END AS group_key
    FROM un
  )
  SELECT
    c.group_kind,
    c.group_key,
    CASE WHEN c.group_kind='channel' THEN cn.channel_name ELSE NULL END AS display_name,
    count(*)::int AS ticket_count
  FROM classified c
  LEFT JOIN public.v3_channel_names cn
    ON c.group_kind='channel' AND cn.slack_channel_id = c.group_key
  GROUP BY c.group_kind, c.group_key, cn.channel_name
  ORDER BY ticket_count DESC, c.group_kind, c.group_key;
$$;

-- 7) Channels usage helper: distinct customer Slack channels with counts & mapping status
CREATE OR REPLACE FUNCTION public.v3_channels_usage()
RETURNS TABLE(
  slack_channel_id text,
  channel_name text,
  ticket_count integer,
  status text,       -- 'mapped' | 'internal' | 'unmapped'
  account_key text,
  account_label text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH counts AS (
    SELECT slack_channel_id_detected AS slack_channel_id, count(*)::int AS ticket_count
    FROM public.intercom_tickets_v3
    WHERE slack_channel_id_detected IS NOT NULL AND slack_channel_id_detected <> ''
    GROUP BY slack_channel_id_detected
  )
  SELECT
    c.slack_channel_id,
    cn.channel_name,
    c.ticket_count,
    CASE
      WHEN ic.slack_channel_id IS NOT NULL THEN 'internal'
      WHEN cm.slack_channel_id IS NOT NULL THEN 'mapped'
      ELSE 'unmapped'
    END AS status,
    cm.account_key,
    a.label AS account_label
  FROM counts c
  LEFT JOIN public.v3_channel_names cn ON cn.slack_channel_id = c.slack_channel_id
  LEFT JOIN public.v3_internal_channels ic ON ic.slack_channel_id = c.slack_channel_id
  LEFT JOIN public.v3_channel_account_map cm ON cm.slack_channel_id = c.slack_channel_id
  LEFT JOIN public.v3_customer_accounts a ON a.account_key = cm.account_key
  ORDER BY (CASE WHEN ic.slack_channel_id IS NULL AND cm.slack_channel_id IS NULL THEN 0 ELSE 1 END), c.ticket_count DESC;
$$;

-- 8) Account ticket counts helper (verified + orphan flag)
CREATE OR REPLACE FUNCTION public.v3_accounts_usage()
RETURNS TABLE(account_key text, ticket_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT customer_key AS account_key, count(*)::int AS ticket_count
  FROM public.intercom_tickets_v3
  WHERE customer_key <> 'unattributed'
  GROUP BY customer_key;
$$;

-- 9) Orphan overrides list helper
CREATE OR REPLACE FUNCTION public.v3_orphan_overrides()
RETURNS TABLE(customer_key text, ticket_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT customer_key, count(*)::int AS ticket_count
  FROM public.intercom_tickets_v3
  WHERE customer_resolution_method='override'
    AND customer_key NOT IN (SELECT account_key FROM public.v3_customer_accounts)
  GROUP BY customer_key
  ORDER BY count(*) DESC;
$$;
