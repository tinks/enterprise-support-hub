
-- Phase 3c: proposals table + suggestion RPCs

CREATE TABLE IF NOT EXISTS public.v3_channel_account_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel_id text NOT NULL UNIQUE,
  channel_name text,
  proposed_account_key text NOT NULL REFERENCES public.v3_customer_accounts(account_key) ON DELETE CASCADE,
  evidence text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high','medium')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.v3_channel_account_proposals TO authenticated;
GRANT ALL ON public.v3_channel_account_proposals TO service_role;
ALTER TABLE public.v3_channel_account_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v3_channel_proposals_read" ON public.v3_channel_account_proposals;
CREATE POLICY "v3_channel_proposals_read" ON public.v3_channel_account_proposals
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "v3_channel_proposals_admin_write" ON public.v3_channel_account_proposals;
CREATE POLICY "v3_channel_proposals_admin_write" ON public.v3_channel_account_proposals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS v3_channel_proposals_touch ON public.v3_channel_account_proposals;
CREATE TRIGGER v3_channel_proposals_touch
  BEFORE UPDATE ON public.v3_channel_account_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Orphan override suggestions
CREATE OR REPLACE FUNCTION public.v3_orphan_override_suggestions()
RETURNS TABLE(orphan_key text, ticket_count int, suggested_account_key text, suggested_label text, match_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH orphans AS (
    SELECT customer_key AS k, count(*)::int AS n
    FROM public.intercom_tickets_v3
    WHERE customer_resolution_method='override'
      AND customer_key NOT IN (SELECT account_key FROM public.v3_customer_accounts)
    GROUP BY customer_key
  ),
  norm AS (
    SELECT o.k, o.n,
      trim(both '_' from regexp_replace(lower(trim(o.k)), '[^a-z0-9]+', '_', 'g')) AS nk
    FROM orphans o
  ),
  exact AS (
    SELECT DISTINCT ON (nrm.k) nrm.k, nrm.n, a.account_key, a.label, 'exact_normalized'::text AS mk
    FROM norm nrm
    JOIN public.v3_customer_accounts a
      ON a.account_key = nrm.nk
      OR trim(both '_' from regexp_replace(lower(trim(a.label)),'[^a-z0-9]+','_','g')) = nrm.nk
      OR nrm.nk = ANY(coalesce(a.aliases,'{}'::text[]))
    ORDER BY nrm.k, a.account_key
  ),
  fuzzy AS (
    SELECT DISTINCT ON (nrm.k) nrm.k, nrm.n, a.account_key, a.label, 'fuzzy'::text AS mk
    FROM norm nrm
    JOIN public.v3_customer_accounts a
      ON length(nrm.nk) >= 4 AND length(a.account_key) >= 3
     AND (split_part(nrm.nk,'_',1) = a.account_key
          OR nrm.nk LIKE a.account_key || '\_%'
          OR a.account_key LIKE nrm.nk || '\_%')
    WHERE nrm.k NOT IN (SELECT k FROM exact)
    ORDER BY nrm.k, length(a.account_key) DESC, a.account_key
  ),
  combined AS (
    SELECT k, n, account_key, label, mk FROM exact
    UNION ALL SELECT k, n, account_key, label, mk FROM fuzzy
  ),
  none_m AS (
    SELECT nrm.k, nrm.n, NULL::text, NULL::text, 'none'::text
    FROM norm nrm WHERE nrm.k NOT IN (SELECT k FROM combined)
  ),
  final AS (
    SELECT * FROM combined UNION ALL SELECT * FROM none_m
  )
  SELECT k, n, account_key, label, mk FROM final ORDER BY n DESC, k;
$$;

-- Channel proposals generator (admin only)
CREATE OR REPLACE FUNCTION public.v3_generate_channel_proposals()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  total int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.v3_channel_account_proposals WHERE status='pending';

  -- (a) Co-occurrence via domain-resolved tickets on the channel
  WITH candidates AS (
    SELECT DISTINCT slack_channel_id_detected AS cid
    FROM public.intercom_tickets_v3
    WHERE slack_channel_id_detected IS NOT NULL
      AND slack_channel_id_detected <> ''
      AND slack_channel_id_detected NOT IN (SELECT slack_channel_id FROM public.v3_channel_account_map)
      AND slack_channel_id_detected NOT IN (SELECT slack_channel_id FROM public.v3_internal_channels)
  ),
  cooc AS (
    SELECT c.cid, t.customer_key AS account_key, count(*)::int AS n
    FROM candidates c
    JOIN public.intercom_tickets_v3 t
      ON t.slack_channel_id_detected = c.cid
     AND t.customer_resolution_method='domain'
     AND t.customer_key IN (SELECT account_key FROM public.v3_customer_accounts)
    GROUP BY c.cid, t.customer_key
  ),
  best_cooc AS (
    SELECT DISTINCT ON (cid) cid, account_key, n
    FROM cooc ORDER BY cid, n DESC, account_key
  )
  INSERT INTO public.v3_channel_account_proposals(slack_channel_id, channel_name, proposed_account_key, evidence, confidence)
  SELECT b.cid,
         (SELECT channel_name FROM public.v3_channel_names cn WHERE cn.slack_channel_id = b.cid),
         b.account_key,
         format('%s ticket(s) on this channel resolve to %s by domain', b.n, b.account_key),
         'high'
  FROM best_cooc b
  ON CONFLICT (slack_channel_id) DO NOTHING;

  -- (b) Name-convention fallback for channels with no co-occurrence proposal yet
  WITH remaining AS (
    SELECT DISTINCT t.slack_channel_id_detected AS cid,
      (SELECT channel_name FROM public.v3_channel_names cn WHERE cn.slack_channel_id = t.slack_channel_id_detected) AS cname
    FROM public.intercom_tickets_v3 t
    WHERE t.slack_channel_id_detected IS NOT NULL
      AND t.slack_channel_id_detected <> ''
      AND t.slack_channel_id_detected NOT IN (SELECT slack_channel_id FROM public.v3_channel_account_map)
      AND t.slack_channel_id_detected NOT IN (SELECT slack_channel_id FROM public.v3_internal_channels)
      AND t.slack_channel_id_detected NOT IN (SELECT slack_channel_id FROM public.v3_channel_account_proposals)
  ),
  cleaned AS (
    SELECT r.cid, r.cname,
      regexp_split_to_array(
        regexp_replace(
          regexp_replace(lower(coalesce(r.cname,'')),
            '(^|[-_])(ext|external|lovable|admin|customer|support|help|team|proj|project)([-_]|$)',
            '-', 'g'),
          '[^a-z0-9]+', '-', 'g'),
        '-') AS toks
    FROM remaining r
  ),
  toks AS (
    SELECT c.cid, c.cname, tok
    FROM cleaned c
    CROSS JOIN LATERAL unnest(c.toks) AS tok
    WHERE length(tok) >= 3
  ),
  matches AS (
    SELECT t.cid, t.cname, a.account_key, a.label, t.tok
    FROM toks t
    JOIN public.v3_customer_accounts a
      ON a.account_key = t.tok
      OR t.tok = ANY(coalesce(a.aliases,'{}'::text[]))
      OR EXISTS (SELECT 1 FROM unnest(coalesce(a.domains,'{}'::text[])) d WHERE split_part(d,'.',1) = t.tok)
  ),
  best AS (
    SELECT DISTINCT ON (cid) cid, cname, account_key, label, tok
    FROM matches ORDER BY cid, length(tok) DESC, account_key
  )
  INSERT INTO public.v3_channel_account_proposals(slack_channel_id, channel_name, proposed_account_key, evidence, confidence)
  SELECT b.cid, b.cname, b.account_key,
    format('channel name %L -> token %L matches account %s', coalesce(b.cname,''), b.tok, b.account_key),
    'medium'
  FROM best b
  ON CONFLICT (slack_channel_id) DO NOTHING;

  SELECT count(*)::int INTO total FROM public.v3_channel_account_proposals WHERE status='pending';
  RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION public.v3_channel_proposals_pending()
RETURNS TABLE(slack_channel_id text, channel_name text, proposed_account_key text, account_label text, evidence text, confidence text, ticket_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.slack_channel_id, p.channel_name, p.proposed_account_key, a.label,
    p.evidence, p.confidence,
    (SELECT count(*)::int FROM public.intercom_tickets_v3 t
     WHERE t.slack_channel_id_detected = p.slack_channel_id) AS ticket_count
  FROM public.v3_channel_account_proposals p
  JOIN public.v3_customer_accounts a ON a.account_key = p.proposed_account_key
  WHERE p.status='pending'
  ORDER BY (CASE WHEN p.confidence='high' THEN 0 ELSE 1 END),
    (SELECT count(*) FROM public.intercom_tickets_v3 t WHERE t.slack_channel_id_detected = p.slack_channel_id) DESC;
$$;
