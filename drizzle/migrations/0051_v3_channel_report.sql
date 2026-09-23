-- Access-point (intake channel) classification for the v3 dataset.
--
-- Computed server-side so raw_payload (large jsonb) never ships to the client.
-- Classification order is deliberate and mutually exclusive:
--   1. in_app_form  - sticky Hub detection (Intercom tag / attribute / form template)
--   2. slack        - relayed from a Slack channel (slack_channel_id_detected)
--   3. email        - Intercom source.type = 'email'
--   4. messenger    - Intercom source.type = 'conversation' (in-product widget)
--   5. other        - admin-initiated or missing source payload
--
-- Read-only. No writes, no mutation of v3_derive_customer or any trigger.
CREATE OR REPLACE FUNCTION public.v3_channel_report(
  _from timestamptz,
  _to   timestamptz
)
RETURNS TABLE(
  id uuid,
  intercom_conversation_id text,
  channel text,
  subject text,
  intercom_created_at timestamptz,
  finalized_at timestamptz,
  lifecycle_status text,
  state text,
  customer_key text,
  product_area text,
  ticket_type text,
  plan_tier text,
  csat_rating integer,
  csat_rater_is_internal boolean,
  resolution_active_s integer,
  time_to_first_human_reply_s integer,
  is_test_ticket boolean,
  tags text[],
  rsa_override boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.intercom_conversation_id,
    CASE
      WHEN t.is_in_app_form IS TRUE THEN 'in_app_form'
      WHEN t.slack_channel_id_detected IS NOT NULL THEN 'slack'
      WHEN t.raw_payload->'source'->>'type' = 'email' THEN 'email'
      WHEN t.raw_payload->'source'->>'type' = 'conversation' THEN 'messenger'
      ELSE 'other'
    END AS channel,
    COALESCE(NULLIF(t.subject_override, ''), NULLIF(t.subject, ''), '(no subject)') AS subject,
    t.intercom_created_at,
    t.finalized_at,
    t.lifecycle_status,
    t.state,
    t.customer_key,
    COALESCE(
      NULLIF(t.custom_attributes->>'Affected Product Area', ''),
      NULLIF(t.custom_attributes->>'Product Area', ''),
      NULLIF(t.product_area, ''),
      'Unclassified'
    ) AS product_area,
    COALESCE(
      NULLIF(t.custom_attributes->>'Ticket type', ''),
      NULLIF(t.classification, ''),
      'Unclassified'
    ) AS ticket_type,
    t.plan_tier,
    t.csat_rating,
    t.csat_rater_is_internal,
    t.resolution_active_s,
    t.time_to_first_human_reply_s,
    t.is_test_ticket,
    t.tags,
    t.rsa_override
  FROM public.intercom_tickets_v3 t
  WHERE t.intercom_created_at >= GREATEST(_from, timestamptz '2026-06-01T00:00:00Z')
    AND t.intercom_created_at <= _to;
$$;

REVOKE ALL ON FUNCTION public.v3_channel_report(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v3_channel_report(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.v3_channel_report(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v3_channel_report(timestamptz, timestamptz) TO service_role;