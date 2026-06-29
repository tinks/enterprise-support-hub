
-- =========================================================================
-- Inbox v3: reporting-grade mirror of Intercom enterprise tickets.
-- Closed tickets get one full sync on finalize and are then frozen.
-- Open tickets get cheap search-payload-only refreshes.
-- Parallel to v2 — does NOT replace inbox_v2_tickets.
-- =========================================================================

CREATE TABLE public.intercom_tickets_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_conversation_id text NOT NULL UNIQUE,

  -- Assignment / ownership
  team_assignee_id text,
  admin_assignee_id text,
  owner text,

  -- Contact
  contact_name text,
  contact_email text,
  contact_domain text,

  -- Display
  subject text,

  -- Intercom state vs our lifecycle state
  state text,                          -- intercom: open / closed / snoozed
  lifecycle_status text NOT NULL DEFAULT 'open',
    -- 'open' | 'finalized' | 'reopened_after_finalize'

  -- Reporting dimensions (written on finalize only)
  product_area text,
  classification text,
  tags text[] NOT NULL DEFAULT '{}'::text[],

  -- CSAT
  csat_rating int,
  csat_remark text,
  csat_rated_at timestamptz,

  -- Pre-computed timing (snapshot at finalize)
  time_to_first_admin_reply_s int,
  time_to_resolve_s int,

  -- Intercom timeline
  intercom_created_at timestamptz,
  intercom_updated_at timestamptz,
  intercom_closed_at timestamptz,

  -- Our lifecycle audit
  finalized_at timestamptz,
  reopen_count int NOT NULL DEFAULT 0,
  last_reopened_at timestamptz,

  -- Bookkeeping
  last_synced_at timestamptz,
  last_full_fetch_at timestamptz,
  raw_payload jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intercom_tickets_v3_csat_range CHECK (
    csat_rating IS NULL OR (csat_rating >= 1 AND csat_rating <= 5)
  ),
  CONSTRAINT intercom_tickets_v3_lifecycle_chk CHECK (
    lifecycle_status IN ('open', 'finalized', 'reopened_after_finalize')
  )
);

CREATE INDEX intercom_tickets_v3_closed_at_idx
  ON public.intercom_tickets_v3 (intercom_closed_at DESC)
  WHERE intercom_closed_at IS NOT NULL;
CREATE INDEX intercom_tickets_v3_updated_at_idx
  ON public.intercom_tickets_v3 (intercom_updated_at DESC);
CREATE INDEX intercom_tickets_v3_lifecycle_idx
  ON public.intercom_tickets_v3 (lifecycle_status);
CREATE INDEX intercom_tickets_v3_owner_idx
  ON public.intercom_tickets_v3 (owner);

GRANT SELECT ON public.intercom_tickets_v3 TO authenticated;
GRANT ALL    ON public.intercom_tickets_v3 TO service_role;

ALTER TABLE public.intercom_tickets_v3 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read intercom_tickets_v3"
  ON public.intercom_tickets_v3 FOR SELECT
  TO authenticated USING (true);

CREATE TRIGGER set_intercom_tickets_v3_updated_at
  BEFORE UPDATE ON public.intercom_tickets_v3
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =========================================================================
-- Resumable sync job state (one active row per kind)
-- =========================================================================

CREATE TABLE public.intercom_sync_jobs_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
    -- 'closed_backfill' | 'open_refresh' | 'gap_scan'
  status text NOT NULL DEFAULT 'idle',
    -- 'idle' | 'running' | 'done' | 'error'
  cursor_ts timestamptz,
  cursor_extra jsonb,
  window_start timestamptz,
  window_end timestamptz,
  processed int NOT NULL DEFAULT 0,
  inserted int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intercom_sync_jobs_v3_kind_chk CHECK (
    kind IN ('closed_backfill', 'open_refresh', 'gap_scan')
  ),
  CONSTRAINT intercom_sync_jobs_v3_status_chk CHECK (
    status IN ('idle', 'running', 'done', 'error')
  )
);

CREATE INDEX intercom_sync_jobs_v3_kind_status_idx
  ON public.intercom_sync_jobs_v3 (kind, status, created_at DESC);

GRANT SELECT ON public.intercom_sync_jobs_v3 TO authenticated;
GRANT ALL    ON public.intercom_sync_jobs_v3 TO service_role;

ALTER TABLE public.intercom_sync_jobs_v3 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read intercom_sync_jobs_v3"
  ON public.intercom_sync_jobs_v3 FOR SELECT
  TO authenticated USING (true);

CREATE TRIGGER set_intercom_sync_jobs_v3_updated_at
  BEFORE UPDATE ON public.intercom_sync_jobs_v3
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
