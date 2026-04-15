CREATE OR REPLACE FUNCTION public.search_conversations(search_term text)
RETURNS TABLE (
  result_id uuid,
  result_source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ilike_term text := '%' || search_term || '%';
BEGIN
  RETURN QUERY
  SELECT id, 'slack'::text FROM conversation_mappings
  WHERE id::text ILIKE ilike_term
     OR original_message_text ILIKE ilike_term
     OR status ILIKE ilike_term
     OR product_area ILIKE ilike_term
     OR slack_user_id ILIKE ilike_term
     OR slack_channel_id ILIKE ilike_term
     OR intercom_conversation_id ILIKE ilike_term
     OR slack_user_name ILIKE ilike_term
     OR owner ILIKE ilike_term
     OR classification ILIKE ilike_term;

  RETURN QUERY
  SELECT id, 'gmail'::text FROM gmail_conversations
  WHERE id::text ILIKE ilike_term
     OR from_email ILIKE ilike_term
     OR from_name ILIKE ilike_term
     OR subject ILIKE ilike_term
     OR snippet ILIKE ilike_term
     OR status ILIKE ilike_term
     OR product_area ILIKE ilike_term
     OR intercom_conversation_id ILIKE ilike_term
     OR owner ILIKE ilike_term
     OR classification ILIKE ilike_term;

  RETURN QUERY
  SELECT id, 'manual'::text FROM manual_conversations
  WHERE id::text ILIKE ilike_term
     OR contact_name ILIKE ilike_term
     OR subject ILIKE ilike_term
     OR source ILIKE ilike_term
     OR status ILIKE ilike_term
     OR product_area ILIKE ilike_term
     OR intercom_conversation_id ILIKE ilike_term
     OR owner ILIKE ilike_term
     OR classification ILIKE ilike_term
     OR link ILIKE ilike_term;

  RETURN QUERY
  SELECT DISTINCT mm.conversation_id, 'manual'::text
  FROM manual_messages mm
  WHERE mm.message_text ILIKE ilike_term;
END;
$$;