CREATE OR REPLACE FUNCTION public.v3_no_signal_tickets()
RETURNS TABLE (
  id uuid,
  intercom_conversation_id text,
  subject text,
  contact_email text,
  contact_domain text,
  slack_channel_id_detected text,
  workspace_id_detected text,
  intercom_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- keep in sync with v3_unattributed_groups no_signal branch
  SELECT t.id, t.intercom_conversation_id, t.subject, t.contact_email, t.contact_domain,
         t.slack_channel_id_detected, t.workspace_id_detected, t.intercom_created_at
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND NOT (t.contact_domain IS NOT NULL AND t.contact_domain <> '' AND t.contact_domain <> 'lovable.dev'
             AND NOT EXISTS (SELECT 1 FROM public.v3_customer_accounts a WHERE t.contact_domain = ANY(a.domains))
             AND NOT EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain))
    AND NOT (t.slack_channel_id_detected IS NOT NULL AND t.slack_channel_id_detected <> ''
             AND NOT EXISTS (SELECT 1 FROM public.v3_internal_channels i WHERE i.slack_channel_id = t.slack_channel_id_detected)
             AND NOT EXISTS (SELECT 1 FROM public.v3_channel_account_map cm WHERE cm.slack_channel_id = t.slack_channel_id_detected))
    AND NOT (t.workspace_id_detected IS NOT NULL AND t.workspace_id_detected <> ''
             AND NOT EXISTS (SELECT 1 FROM public.v3_workspace_customer_map wm WHERE wm.workspace_id = t.workspace_id_detected))
  ORDER BY t.intercom_created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.v3_no_signal_tickets() TO authenticated;