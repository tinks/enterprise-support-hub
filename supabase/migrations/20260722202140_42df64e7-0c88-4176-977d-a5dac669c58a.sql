-- Split personal-email unattributed tickets into their own "personal_unlabeled" group
-- so a forgotten `enterprise-prospect-personal-acct` label is surfaced loudly instead of
-- silently absorbed into the generic no_signal bucket.

CREATE OR REPLACE FUNCTION public.v3_unattributed_groups()
 RETURNS TABLE(group_kind text, group_key text, display_name text, ticket_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH un AS (
    SELECT t.id, t.contact_domain, t.slack_channel_id_detected, t.workspace_id_detected
    FROM public.intercom_tickets_v3 t
    WHERE t.customer_key = 'unattributed'
  ),
  classified AS (
    SELECT
      un.id,
      CASE
        WHEN un.contact_domain IS NOT NULL
          AND un.contact_domain <> ''
          AND un.contact_domain <> 'lovable.dev'
          AND NOT EXISTS (SELECT 1 FROM public.v3_customer_accounts a WHERE un.contact_domain = ANY(a.domains))
          AND NOT EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
          THEN 'domain'
        WHEN un.slack_channel_id_detected IS NOT NULL
          AND un.slack_channel_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_internal_channels i WHERE i.slack_channel_id = un.slack_channel_id_detected)
          AND NOT EXISTS (SELECT 1 FROM public.v3_channel_account_map cm WHERE cm.slack_channel_id = un.slack_channel_id_detected)
          THEN 'channel'
        WHEN un.workspace_id_detected IS NOT NULL
          AND un.workspace_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_workspace_customer_map wm WHERE wm.workspace_id = un.workspace_id_detected)
          THEN 'workspace'
        -- Catch-and-surface: personal-email tickets still unattributed (i.e. NOT yet given the
        -- `enterprise-prospect-personal-acct` label). Kept as their OWN group instead of no_signal
        -- so a forgotten label stays loud. Keep in sync with v3_personal_unlabeled_tickets().
        WHEN un.contact_domain IS NOT NULL AND un.contact_domain <> ''
          AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
          THEN 'personal_unlabeled'
        ELSE 'no_signal'
      END AS group_kind,
      CASE
        WHEN un.contact_domain IS NOT NULL
          AND un.contact_domain <> ''
          AND un.contact_domain <> 'lovable.dev'
          AND NOT EXISTS (SELECT 1 FROM public.v3_customer_accounts a WHERE un.contact_domain = ANY(a.domains))
          AND NOT EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
          THEN un.contact_domain
        WHEN un.slack_channel_id_detected IS NOT NULL
          AND un.slack_channel_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_internal_channels i WHERE i.slack_channel_id = un.slack_channel_id_detected)
          AND NOT EXISTS (SELECT 1 FROM public.v3_channel_account_map cm WHERE cm.slack_channel_id = un.slack_channel_id_detected)
          THEN un.slack_channel_id_detected
        WHEN un.workspace_id_detected IS NOT NULL
          AND un.workspace_id_detected <> ''
          AND NOT EXISTS (SELECT 1 FROM public.v3_workspace_customer_map wm WHERE wm.workspace_id = un.workspace_id_detected)
          THEN un.workspace_id_detected
        WHEN un.contact_domain IS NOT NULL AND un.contact_domain <> ''
          AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = un.contact_domain)
          THEN ''
        ELSE ''
      END AS group_key
    FROM un
  )
  SELECT
    c.group_kind,
    c.group_key,
    CASE
      WHEN c.group_kind='channel' THEN cn.channel_name
      WHEN c.group_kind='personal_unlabeled' THEN 'Likely personal — needs label'
      ELSE NULL
    END AS display_name,
    count(*)::int AS ticket_count
  FROM classified c
  LEFT JOIN public.v3_channel_names cn
    ON c.group_kind='channel' AND cn.slack_channel_id = c.group_key
  GROUP BY c.group_kind, c.group_key, cn.channel_name
  ORDER BY ticket_count DESC, c.group_kind, c.group_key;
$function$;

-- No-signal now excludes personal-email tickets (they live in personal_unlabeled).
-- Keep in sync with v3_unattributed_groups no_signal branch.
CREATE OR REPLACE FUNCTION public.v3_no_signal_tickets()
 RETURNS TABLE(id uuid, intercom_conversation_id text, subject text, contact_email text, contact_domain text, slack_channel_id_detected text, workspace_id_detected text, intercom_created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Exclude personal-email tickets — surfaced separately as personal_unlabeled.
    AND NOT (t.contact_domain IS NOT NULL AND t.contact_domain <> ''
             AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain))
  ORDER BY t.intercom_created_at DESC;
$function$;

-- New: mirror of v3_no_signal_tickets for the personal_unlabeled bucket.
-- Keep in sync with v3_unattributed_groups personal_unlabeled branch.
CREATE OR REPLACE FUNCTION public.v3_personal_unlabeled_tickets()
 RETURNS TABLE(id uuid, intercom_conversation_id text, subject text, contact_email text, contact_domain text, slack_channel_id_detected text, workspace_id_detected text, intercom_created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.intercom_conversation_id, t.subject, t.contact_email, t.contact_domain,
         t.slack_channel_id_detected, t.workspace_id_detected, t.intercom_created_at
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND t.contact_domain IS NOT NULL AND t.contact_domain <> ''
    AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain)
  ORDER BY t.intercom_created_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.v3_personal_unlabeled_tickets() TO authenticated;