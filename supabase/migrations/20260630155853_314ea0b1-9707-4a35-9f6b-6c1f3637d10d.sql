
ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS reopen_count_at_finalize INTEGER,
  ADD COLUMN IF NOT EXISTS silent_update_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_silent_change JSONB;

-- Backfill snapshot from raw_payload for already-finalized rows
UPDATE public.intercom_tickets_v3
SET reopen_count_at_finalize = COALESCE(
  NULLIF(raw_payload->'statistics'->>'count_reopens','')::int,
  0
)
WHERE reopen_count_at_finalize IS NULL
  AND raw_payload IS NOT NULL;

-- Clear false reopened flags: rows currently flagged reopened but still closed
-- in Intercom AND whose stored count_reopens has not advanced past the finalize snapshot.
UPDATE public.intercom_tickets_v3
SET lifecycle_status = 'finalized'
WHERE lifecycle_status = 'reopened_after_finalize'
  AND state = 'closed'
  AND COALESCE(NULLIF(raw_payload->'statistics'->>'count_reopens','')::int, 0)
      <= COALESCE(reopen_count_at_finalize, 0);
