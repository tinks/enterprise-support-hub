ALTER TABLE public.inbox_v2_tickets
  ADD COLUMN IF NOT EXISTS csat_rating smallint,
  ADD COLUMN IF NOT EXISTS csat_remark text,
  ADD COLUMN IF NOT EXISTS csat_rated_at timestamptz;

DROP TRIGGER IF EXISTS validate_csat_rating_inbox_v2 ON public.inbox_v2_tickets;
CREATE TRIGGER validate_csat_rating_inbox_v2
  BEFORE INSERT OR UPDATE ON public.inbox_v2_tickets
  FOR EACH ROW EXECUTE FUNCTION public.validate_csat_rating();