
ALTER TABLE public.inbox_v2_tickets
  ADD COLUMN IF NOT EXISTS engagement_override text,
  ADD COLUMN IF NOT EXISTS engagement_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS engagement_override_by text,
  ADD COLUMN IF NOT EXISTS engagement_ai_guess text,
  ADD COLUMN IF NOT EXISTS engagement_ai_reason text,
  ADD COLUMN IF NOT EXISTS engagement_ai_at timestamptz;

ALTER TABLE public.inbox_v2_tickets
  DROP CONSTRAINT IF EXISTS inbox_v2_tickets_engagement_override_chk;
ALTER TABLE public.inbox_v2_tickets
  ADD CONSTRAINT inbox_v2_tickets_engagement_override_chk
  CHECK (engagement_override IS NULL OR engagement_override IN ('engaged','none'));

ALTER TABLE public.inbox_v2_tickets
  DROP CONSTRAINT IF EXISTS inbox_v2_tickets_engagement_ai_guess_chk;
ALTER TABLE public.inbox_v2_tickets
  ADD CONSTRAINT inbox_v2_tickets_engagement_ai_guess_chk
  CHECK (engagement_ai_guess IS NULL OR engagement_ai_guess IN ('engaged','none'));

GRANT UPDATE ON public.inbox_v2_tickets TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can update inbox v2 tickets" ON public.inbox_v2_tickets;
CREATE POLICY "Authenticated users can update inbox v2 tickets"
  ON public.inbox_v2_tickets
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
