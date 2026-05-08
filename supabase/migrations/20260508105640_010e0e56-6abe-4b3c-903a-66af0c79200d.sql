ALTER TABLE public.conversation_mappings
  ADD COLUMN IF NOT EXISTS csat_rating smallint,
  ADD COLUMN IF NOT EXISTS csat_remark text,
  ADD COLUMN IF NOT EXISTS csat_rated_at timestamptz,
  ADD COLUMN IF NOT EXISTS csat_prompt_ts text;

DROP TRIGGER IF EXISTS validate_csat_rating_conversation_mappings ON public.conversation_mappings;
CREATE TRIGGER validate_csat_rating_conversation_mappings
BEFORE INSERT OR UPDATE ON public.conversation_mappings
FOR EACH ROW EXECUTE FUNCTION public.validate_csat_rating();