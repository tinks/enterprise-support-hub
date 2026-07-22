
DROP FUNCTION IF EXISTS public.v3_no_signal_tickets();
DROP FUNCTION IF EXISTS public.v3_personal_unlabeled_tickets();

CREATE OR REPLACE FUNCTION public.v3_no_signal_tickets()
 RETURNS TABLE(id uuid, intercom_conversation_id text, subject text, contact_email text, contact_domain text, slack_channel_id_detected text, workspace_id_detected text, intercom_created_at timestamptz, last_full_fetch_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT t.id, t.intercom_conversation_id, t.subject, t.contact_email, t.contact_domain,
         t.slack_channel_id_detected, t.workspace_id_detected, t.intercom_created_at, t.last_full_fetch_at
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
    AND NOT (t.contact_domain IS NOT NULL AND t.contact_domain <> ''
             AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain))
  ORDER BY t.intercom_created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.v3_personal_unlabeled_tickets()
 RETURNS TABLE(id uuid, intercom_conversation_id text, subject text, contact_email text, contact_domain text, slack_channel_id_detected text, workspace_id_detected text, intercom_created_at timestamptz, last_full_fetch_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT t.id, t.intercom_conversation_id, t.subject, t.contact_email, t.contact_domain,
         t.slack_channel_id_detected, t.workspace_id_detected, t.intercom_created_at, t.last_full_fetch_at
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND t.contact_domain IS NOT NULL AND t.contact_domain <> ''
    AND EXISTS (SELECT 1 FROM public.v3_personal_email_domains p WHERE p.domain = t.contact_domain)
  ORDER BY t.intercom_created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.v3_unattributed_sync_status()
 RETURNS TABLE(pending_count int, next_full_fetch_at timestamptz, schedule_desc text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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

  SELECT count(*)::int INTO pending_count
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed' AND t.last_full_fetch_at IS NULL;

  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.v3_unattributed_sync_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.v3_no_signal_tickets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.v3_personal_unlabeled_tickets() TO authenticated;
