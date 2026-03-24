CREATE OR REPLACE FUNCTION public.claim_intercom_part(
  p_mapping_id uuid,
  p_part_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_marker text;
BEGIN
  SELECT last_intercom_part_id INTO current_marker
  FROM conversation_mappings
  WHERE id = p_mapping_id
  FOR UPDATE;

  IF current_marker IS NOT NULL THEN
    IF current_marker ~ '^\d+$' AND p_part_id ~ '^\d+$' THEN
      IF current_marker::bigint >= p_part_id::bigint THEN
        RETURN false;
      END IF;
    ELSIF current_marker = p_part_id THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE conversation_mappings
  SET last_intercom_part_id = p_part_id
  WHERE id = p_mapping_id;

  RETURN true;
END;
$$;