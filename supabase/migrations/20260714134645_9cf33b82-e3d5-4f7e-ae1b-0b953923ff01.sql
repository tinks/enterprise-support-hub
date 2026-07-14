CREATE OR REPLACE FUNCTION public.v3_generate_channel_proposals()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  total int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Only clear pending; confirmed/rejected proposals are preserved.
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
            -- Strip generic/noise tokens so they don't reach account matching.
            -- Added: `account` (fixes `account-microsoft`), `external` was already listed
            -- but re-affirmed here alongside `ext` to catch prefix/suffix/standalone forms.
            '(^|[-_])(ext|external|lovable|admin|customer|support|help|team|proj|project|account)([-_]|$)',
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
      -- Domain match: token must equal the domain's REGISTRABLE label
      -- (second-level label, i.e. the label immediately before the TLD).
      -- Prevents `external` from matching `external.telekom.com`.
      OR EXISTS (
        SELECT 1
        FROM unnest(coalesce(a.domains,'{}'::text[])) d
        WHERE split_part(
                d, '.',
                GREATEST(array_length(string_to_array(d,'.'),1) - 1, 1)
              ) = t.tok
      )
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