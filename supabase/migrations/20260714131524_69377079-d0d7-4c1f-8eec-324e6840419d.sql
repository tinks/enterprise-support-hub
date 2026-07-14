
-- One-off seed of the proposals table (runs as owner, bypasses admin check)
DELETE FROM public.v3_channel_account_proposals WHERE status='pending';

WITH candidates AS (
  SELECT DISTINCT slack_channel_id_detected AS cid
  FROM public.intercom_tickets_v3
  WHERE slack_channel_id_detected IS NOT NULL AND slack_channel_id_detected <> ''
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

WITH remaining AS (
  SELECT DISTINCT t.slack_channel_id_detected AS cid,
    (SELECT channel_name FROM public.v3_channel_names cn WHERE cn.slack_channel_id = t.slack_channel_id_detected) AS cname
  FROM public.intercom_tickets_v3 t
  WHERE t.slack_channel_id_detected IS NOT NULL AND t.slack_channel_id_detected <> ''
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
  SELECT c.cid, c.cname, tok FROM cleaned c
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
