
CREATE OR REPLACE FUNCTION public.v3_tickets_for_channel(_channel_id text)
RETURNS TABLE(
  id uuid,
  intercom_conversation_id text,
  subject text,
  intercom_created_at timestamptz,
  customer_key text,
  customer_resolution_method text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matches AS (
    SELECT t.id, t.intercom_conversation_id, t.subject, t.intercom_created_at,
           t.customer_key, t.customer_resolution_method
    FROM public.intercom_tickets_v3 t
    WHERE t.slack_channel_id_detected = _channel_id
  ), total AS (
    SELECT count(*)::bigint AS c FROM matches
  )
  SELECT m.id, m.intercom_conversation_id, m.subject, m.intercom_created_at,
         m.customer_key, m.customer_resolution_method, total.c
  FROM matches m CROSS JOIN total
  ORDER BY m.intercom_created_at DESC NULLS LAST
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.v3_tickets_for_override_key(_key text)
RETURNS TABLE(
  id uuid,
  intercom_conversation_id text,
  subject text,
  intercom_created_at timestamptz,
  customer_key text,
  customer_resolution_method text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matches AS (
    SELECT t.id, t.intercom_conversation_id, t.subject, t.intercom_created_at,
           t.customer_key, t.customer_resolution_method
    FROM public.intercom_tickets_v3 t
    WHERE t.customer_override_key = _key
  ), total AS (
    SELECT count(*)::bigint AS c FROM matches
  )
  SELECT m.id, m.intercom_conversation_id, m.subject, m.intercom_created_at,
         m.customer_key, m.customer_resolution_method, total.c
  FROM matches m CROSS JOIN total
  ORDER BY m.intercom_created_at DESC NULLS LAST
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.v3_tickets_for_channel(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v3_tickets_for_override_key(text) TO authenticated;
