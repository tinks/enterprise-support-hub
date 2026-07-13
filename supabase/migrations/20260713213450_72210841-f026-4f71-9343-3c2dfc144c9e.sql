
-- 1) Snapshot table
CREATE TABLE public.v3_coverage_snapshots (
  snapshot_date date PRIMARY KEY,
  total_tickets integer NOT NULL DEFAULT 0,
  attributed integer NOT NULL DEFAULT 0,
  unattributed integer NOT NULL DEFAULT 0,
  pct_attributed numeric(5,2) NOT NULL DEFAULT 0,
  m_override integer NOT NULL DEFAULT 0,
  m_slack_channel integer NOT NULL DEFAULT 0,
  m_domain integer NOT NULL DEFAULT 0,
  m_workspace_id integer NOT NULL DEFAULT 0,
  m_unresolved integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.v3_coverage_snapshots TO authenticated;
GRANT ALL ON public.v3_coverage_snapshots TO service_role;

ALTER TABLE public.v3_coverage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read coverage snapshots"
  ON public.v3_coverage_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "admin write coverage snapshots"
  ON public.v3_coverage_snapshots FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_v3_coverage_snapshots_updated_at
  BEFORE UPDATE ON public.v3_coverage_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Current coverage RPC (aggregate on server)
CREATE OR REPLACE FUNCTION public.v3_coverage_current()
RETURNS TABLE(
  total_tickets integer,
  attributed integer,
  unattributed integer,
  pct_attributed numeric,
  m_override integer,
  m_slack_channel integer,
  m_domain integer,
  m_workspace_id integer,
  m_unresolved integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (
    SELECT
      count(*)::int AS total_tickets,
      count(*) FILTER (WHERE customer_key IS DISTINCT FROM 'unattributed')::int AS attributed,
      count(*) FILTER (WHERE customer_key = 'unattributed')::int AS unattributed,
      count(*) FILTER (WHERE customer_resolution_method = 'override')::int AS m_override,
      count(*) FILTER (WHERE customer_resolution_method = 'slack_channel')::int AS m_slack_channel,
      count(*) FILTER (WHERE customer_resolution_method = 'domain')::int AS m_domain,
      count(*) FILTER (WHERE customer_resolution_method = 'workspace_id')::int AS m_workspace_id,
      count(*) FILTER (WHERE customer_resolution_method = 'unresolved' OR customer_resolution_method IS NULL)::int AS m_unresolved
    FROM public.intercom_tickets_v3
  )
  SELECT
    total_tickets, attributed, unattributed,
    CASE WHEN total_tickets > 0
      THEN ROUND((attributed::numeric / total_tickets::numeric) * 100, 2)
      ELSE 0 END AS pct_attributed,
    m_override, m_slack_channel, m_domain, m_workspace_id, m_unresolved
  FROM s;
$$;

-- 3) Snapshot capture (idempotent per day)
CREATE OR REPLACE FUNCTION public.v3_capture_coverage_snapshot()
RETURNS public.v3_coverage_snapshots
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c record;
  r public.v3_coverage_snapshots;
BEGIN
  SELECT * INTO c FROM public.v3_coverage_current();
  INSERT INTO public.v3_coverage_snapshots AS s (
    snapshot_date, total_tickets, attributed, unattributed, pct_attributed,
    m_override, m_slack_channel, m_domain, m_workspace_id, m_unresolved
  ) VALUES (
    current_date, c.total_tickets, c.attributed, c.unattributed, c.pct_attributed,
    c.m_override, c.m_slack_channel, c.m_domain, c.m_workspace_id, c.m_unresolved
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
    updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- 4) Unattributed groups RPC — server-side aggregation
CREATE OR REPLACE FUNCTION public.v3_unattributed_groups()
RETURNS TABLE(
  group_kind text,       -- 'domain' | 'channel' | 'workspace' | 'no_signal'
  group_key text,        -- signal value (domain / channel id / workspace id / '')
  ticket_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH un AS (
    SELECT
      t.id,
      t.contact_domain,
      t.slack_channel_id_detected,
      t.workspace_id_detected
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
  SELECT group_kind, group_key, count(*)::int AS ticket_count
  FROM classified
  GROUP BY group_kind, group_key
  ORDER BY ticket_count DESC, group_kind, group_key;
$$;

-- 5) Seed today's baseline
SELECT public.v3_capture_coverage_snapshot();

-- 6) Daily schedule at 06:00 UTC
DO $$
BEGIN
  PERFORM cron.unschedule('v3_capture_coverage_snapshot_daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'v3_capture_coverage_snapshot_daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'v3_capture_coverage_snapshot_daily',
  '0 6 * * *',
  $$SELECT public.v3_capture_coverage_snapshot();$$
);
