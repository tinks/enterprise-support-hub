ALTER TABLE public.intercom_tickets_v3
  DROP CONSTRAINT IF EXISTS intercom_tickets_v3_lifecycle_status_check;

ALTER TABLE public.intercom_tickets_v3
  ADD CONSTRAINT intercom_tickets_v3_lifecycle_status_check
  CHECK (lifecycle_status IN ('open','finalized','reopened_after_finalize','transferred_out'));

ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS reassigned_team_id text;