-- 1) Missing composite index for the Action Center staleness probe
--    (status='done' AND kind=? ORDER BY finished_at DESC LIMIT 1)
CREATE INDEX IF NOT EXISTS intercom_sync_jobs_v3_kind_status_finished_idx
  ON public.intercom_sync_jobs_v3 (kind, status, finished_at DESC)
  WHERE finished_at IS NOT NULL;

-- 2) Bloat guard: these tables are update-heavy; make autovacuum reclaim sooner
ALTER TABLE public.intercom_tickets_v3
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.esh_search_index
  SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE public.intercom_sync_jobs_v3
  SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE public.v3_ticket_attributes
  SET (autovacuum_vacuum_scale_factor = 0.05);

-- 3) Snapshot-served coverage: return today's snapshot when it is fresh,
--    otherwise recompute once and persist it. Same column shape as
--    v3_coverage_current(), plus as_of/from_cache so the UI can label it.
CREATE OR REPLACE FUNCTION public.v3_coverage_cached(max_age_minutes integer DEFAULT 60)
RETURNS TABLE(
  total_tickets integer, population integer, attributed integer, unattributed integer,
  excluded_not_enterprise integer, excluded_prospect_personal integer,
  excluded_prospect_unmapped integer, excluded_transferred_out integer,
  orphan_overrides integer, pct_attributed numeric,
  m_override integer, m_orphan_override integer, m_slack_channel integer,
  m_domain integer, m_workspace_id integer, m_unresolved integer,
  as_of timestamptz, from_cache boolean
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.v3_coverage_snapshots;
  cached boolean := true;
BEGIN
  SELECT * INTO s
  FROM public.v3_coverage_snapshots
  ORDER BY snapshot_date DESC
  LIMIT 1;

  IF s.snapshot_date IS NULL
     OR COALESCE(s.updated_at, s.created_at) < now() - make_interval(mins => GREATEST(max_age_minutes, 1))
  THEN
    s := public.v3_capture_coverage_snapshot();
    cached := false;
  END IF;

  RETURN QUERY
  SELECT
    s.total_tickets,
    GREATEST(0, s.total_tickets - s.excluded_transferred_out - s.excluded_not_enterprise
               - s.excluded_prospect_personal - s.excluded_prospect_unmapped)::int,
    s.attributed,
    s.unattributed,
    s.excluded_not_enterprise,
    s.excluded_prospect_personal,
    s.excluded_prospect_unmapped,
    s.excluded_transferred_out,
    s.m_orphan_override,
    s.pct_attributed,
    s.m_override,
    s.m_orphan_override,
    s.m_slack_channel,
    s.m_domain,
    s.m_workspace_id,
    s.m_unresolved,
    COALESCE(s.updated_at, s.created_at),
    cached;
END;
$function$;

REVOKE ALL ON FUNCTION public.v3_coverage_cached(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v3_coverage_cached(integer) TO authenticated, service_role;