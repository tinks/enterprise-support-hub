
WITH cte AS (
  SELECT id, contact_email, contact_domain, customer_override_key,
         slack_channel_id_detected, workspace_id_detected, tags
  FROM public.intercom_tickets_v3
  WHERE 'enterprise-prospect-personal-acct' = ANY(tags)
     OR 'enterprise-prospect' = ANY(tags)
), derived AS (
  SELECT c.id, d.customer_key AS nk, d.customer_kind AS nkind, d.customer_source AS nsrc,
         d.customer_confidence AS nconf, d.customer_resolution_method AS nmethod
  FROM cte c
  CROSS JOIN LATERAL public.v3_derive_customer(
    c.contact_email, c.customer_override_key, c.contact_domain,
    c.slack_channel_id_detected, c.workspace_id_detected, c.tags
  ) d
)
UPDATE public.intercom_tickets_v3 t
   SET customer_key = d.nk,
       customer_kind = d.nkind,
       customer_source = d.nsrc,
       customer_confidence = d.nconf,
       customer_resolution_method = d.nmethod
  FROM derived d
 WHERE t.id = d.id
   AND (t.customer_key IS DISTINCT FROM d.nk
        OR t.customer_resolution_method IS DISTINCT FROM d.nmethod);
