ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS triage_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS time_to_triage_s integer,
  ADD COLUMN IF NOT EXISTS time_to_triage_bh_s integer,
  ADD COLUMN IF NOT EXISTS first_human_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS time_to_first_human_reply_s integer,
  ADD COLUMN IF NOT EXISTS time_to_first_human_reply_bh_s integer,
  ADD COLUMN IF NOT EXISTS responsiveness_computed_at timestamptz,
  ADD COLUMN IF NOT EXISTS responsiveness_engine_version integer;

COMMENT ON COLUMN public.intercom_tickets_v3.time_to_triage_s IS
  'Seconds from the SLA clock start (first anchor-inbox assignment, else created_at) until an admin first set the Severity attribute. NULL = never triaged.';
COMMENT ON COLUMN public.intercom_tickets_v3.time_to_first_human_reply_s IS
  'Seconds from the SLA clock start until the first public reply by a human teammate. Excludes Sam/AI, bots, notes, and the shared relay inbox. NULL = no human reply.';

CREATE INDEX IF NOT EXISTS intercom_tickets_v3_responsiveness_version_idx
  ON public.intercom_tickets_v3 (responsiveness_engine_version)
  WHERE lifecycle_status IN ('finalized', 'reopened_after_finalize');