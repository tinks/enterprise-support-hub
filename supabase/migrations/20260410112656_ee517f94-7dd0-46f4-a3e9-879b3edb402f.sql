CREATE OR REPLACE FUNCTION public.claim_slack_event(p_mapping_id uuid, p_event_ts text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_ts text;
BEGIN
  SELECT last_processed_event_ts INTO current_ts
  FROM conversation_mappings
  WHERE id = p_mapping_id
  FOR UPDATE;

  IF current_ts IS NOT NULL AND current_ts = p_event_ts THEN
    RETURN false;
  END IF;

  UPDATE conversation_mappings
  SET last_processed_event_ts = p_event_ts
  WHERE id = p_mapping_id;

  RETURN true;
END;
$$;