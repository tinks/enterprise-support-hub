DROP FUNCTION IF EXISTS public.v3_unattributed_sync_status();

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
    AND t.last_full_fetch_at IS NULL
    AND t.intercom_closed_at IS NULL;

  SELECT count(*)::int INTO pending_closed
  FROM public.intercom_tickets_v3 t
  WHERE t.customer_key = 'unattributed'
    AND t.last_full_fetch_at IS NULL
    AND t.intercom_closed_at IS NOT NULL;

  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.v3_unattributed_sync_status() TO authenticated;