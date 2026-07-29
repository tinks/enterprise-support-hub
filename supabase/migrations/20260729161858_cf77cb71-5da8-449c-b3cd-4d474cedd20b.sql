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
      AND t.lifecycle_status <> 'transferred_out'
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

CREATE OR REPLACE FUNCTION public.v3_no_signal_tickets()
 RETURNS TABLE(id uuid, intercom_conversation_id text, subject text, contact_email text, contact_domain text, slack_channel_id_detected text, workspace_id_detected text, intercom_created_at timestamp with time zone, last_full_fetch_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.intercom_conversation_id, t.subject, t.contact_email, t.contact_domain,
         t.slack_channel_id_detected, t.workspace_id_detected, t.intercom_created_at, t.last_full_fetch_at
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND t.lifecycle_status <> 'transferred_out'
    AND NOT (t.contact_domain IS NOT NULL AND t.contact_domain <> '' AND t.contact_domain <> 'lovable.dev'
             AND NOT EXISTS (SELECT 1 FROM public.v3_customer_accounts a WHERE t.contact_domain = ANY(a.domains))
             AND NOT EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain))
    AND NOT (t.slack_channel_id_detected IS NOT NULL AND t.slack_channel_id_detected <> ''
             AND NOT EXISTS (SELECT 1 FROM public.v3_internal_channels i WHERE i.slack_channel_id = t.slack_channel_id_detected)
             AND NOT EXISTS (SELECT 1 FROM public.v3_channel_account_map cm WHERE cm.slack_channel_id = t.slack_channel_id_detected))
    AND NOT (t.workspace_id_detected IS NOT NULL AND t.workspace_id_detected <> ''
             AND NOT EXISTS (SELECT 1 FROM public.v3_workspace_customer_map wm WHERE wm.workspace_id = t.workspace_id_detected))
    AND NOT (t.contact_domain IS NOT NULL AND t.contact_domain <> ''
             AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain))
  ORDER BY t.intercom_created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.v3_personal_unlabeled_tickets()
 RETURNS TABLE(id uuid, intercom_conversation_id text, subject text, contact_email text, contact_domain text, slack_channel_id_detected text, workspace_id_detected text, intercom_created_at timestamp with time zone, last_full_fetch_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.intercom_conversation_id, t.subject, t.contact_email, t.contact_domain,
         t.slack_channel_id_detected, t.workspace_id_detected, t.intercom_created_at, t.last_full_fetch_at
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND t.lifecycle_status <> 'transferred_out'
    AND t.contact_domain IS NOT NULL AND t.contact_domain <> ''
    AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain)
  ORDER BY t.intercom_created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.v3_unattributed_sync_status()
 RETURNS TABLE(pending_open integer, pending_closed integer, next_full_fetch_at timestamp with time zone, schedule_desc text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sched text;
  n int;
  m int;
BEGIN
  SELECT j.schedule INTO sched FROM cron.job j WHERE j.jobname = 'sync-v3-closed-frequent' LIMIT 1;

  IF sched ~ '^\*/(\d+) \* \* \* \*$' THEN
    n := (regexp_match(sched, '^\*/(\d+)'))[1]::int;
    m := (extract(minute from now())::int) % n;
    next_full_fetch_at := date_trunc('minute', now()) + make_interval(mins => (n - m));
    schedule_desc := 'every ' || n || ' min';
  ELSE
    next_full_fetch_at := now() + interval '15 minutes';
    schedule_desc := COALESCE(sched, 'unknown');
  END IF;

  SELECT count(*)::int INTO pending_open
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND t.lifecycle_status <> 'transferred_out'
    AND t.last_full_fetch_at IS NULL
    AND t.intercom_closed_at IS NULL;

  SELECT count(*)::int INTO pending_closed
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND t.lifecycle_status <> 'transferred_out'
    AND t.last_full_fetch_at IS NULL
    AND t.intercom_closed_at IS NOT NULL;

  RETURN NEXT;
END;
$function$;