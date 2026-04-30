
ALTER TABLE public.manual_conversations
  ADD COLUMN IF NOT EXISTS csat_rating smallint,
  ADD COLUMN IF NOT EXISTS csat_remark text,
  ADD COLUMN IF NOT EXISTS csat_rated_at timestamptz;

ALTER TABLE public.gmail_conversations
  ADD COLUMN IF NOT EXISTS csat_rating smallint,
  ADD COLUMN IF NOT EXISTS csat_remark text,
  ADD COLUMN IF NOT EXISTS csat_rated_at timestamptz;

CREATE OR REPLACE FUNCTION public.validate_csat_rating()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.csat_rating IS NOT NULL AND (NEW.csat_rating < 1 OR NEW.csat_rating > 5) THEN
    RAISE EXCEPTION 'csat_rating must be between 1 and 5, got %', NEW.csat_rating;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_csat_rating_manual ON public.manual_conversations;
CREATE TRIGGER validate_csat_rating_manual
  BEFORE INSERT OR UPDATE OF csat_rating ON public.manual_conversations
  FOR EACH ROW EXECUTE FUNCTION public.validate_csat_rating();

DROP TRIGGER IF EXISTS validate_csat_rating_gmail ON public.gmail_conversations;
CREATE TRIGGER validate_csat_rating_gmail
  BEFORE INSERT OR UPDATE OF csat_rating ON public.gmail_conversations
  FOR EACH ROW EXECUTE FUNCTION public.validate_csat_rating();

CREATE INDEX IF NOT EXISTS idx_manual_conversations_csat_rating
  ON public.manual_conversations(csat_rating)
  WHERE csat_rating IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gmail_conversations_csat_rating
  ON public.gmail_conversations(csat_rating)
  WHERE csat_rating IS NOT NULL;
