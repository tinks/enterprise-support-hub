-- Incidents surfaced in the hub, sourced from the #incidents Slack channel
-- (C07TMQ5E6SC) where the incident.io app posts one announcement per incident
-- and EDITS it in place as the incident progresses. One row per incident,
-- keyed on the incident.io incident number parsed out of the homepage URL.
--
-- Standalone dimension: nothing here writes to or triggers any v3 table.
-- Writes are service-role only (the poller); the app reads.

CREATE TABLE IF NOT EXISTS public.incidents (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- identity
  incident_number           integer NOT NULL UNIQUE,
  reference                 text,                     -- "INC-1907"
  title                     text NOT NULL,

  -- classification (verbatim from the announcement; NULL means the post did not say)
  severity                  text,                     -- "Major", "Minor", ...
  severity_rank             smallint,                 -- lower = worse; NULL when unmapped
  status                    text,                     -- "Investigating", "Fixing", "Reviewing", ...
  status_category           text NOT NULL DEFAULT 'unknown'
                              CHECK (status_category IN ('live','post_incident','closed','unknown')),

  -- customer impact: true only when the announcement carries a PUBLIC status
  -- page link. The incident.io API exposes no status-page endpoint, so this
  -- link is the only honest signal available.
  is_customer_impacting     boolean NOT NULL DEFAULT false,
  status_page_url           text,

  -- links
  incident_url              text,                     -- app.incident.io/.../incidents/1907
  internal_status_url       text,
  incident_channel_id       text,                     -- the inc-1907-* Slack channel
  incident_channel_name     text,

  -- timing
  declared_at               timestamptz NOT NULL,     -- announcement post time
  last_update_at            timestamptz,              -- announcement last-edited time
  resolved_at               timestamptz,              -- first time we observed a non-live status
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_synced_at            timestamptz NOT NULL DEFAULT now(),

  -- provenance
  slack_channel_id          text NOT NULL,
  slack_message_ts          text NOT NULL,
  raw                       jsonb
);

COMMENT ON TABLE public.incidents IS
  'Incidents parsed from the #incidents Slack announcements (incident.io app). Upserted by incident_number; the announcement is edited in place, so re-polling a window is idempotent.';
COMMENT ON COLUMN public.incidents.is_customer_impacting IS
  'True only when the announcement links a public status page. Derived signal, not a field from incident.io.';
COMMENT ON COLUMN public.incidents.resolved_at IS
  'First observation of a non-live status. Approximate: bounded by poll interval, and NULL for incidents already non-live when first ingested.';

CREATE INDEX IF NOT EXISTS incidents_declared_at_idx  ON public.incidents (declared_at DESC);
CREATE INDEX IF NOT EXISTS incidents_live_idx         ON public.incidents (status_category) WHERE status_category = 'live';
CREATE UNIQUE INDEX IF NOT EXISTS incidents_message_ts_idx ON public.incidents (slack_channel_id, slack_message_ts);

GRANT SELECT ON public.incidents TO authenticated;
GRANT ALL    ON public.incidents TO service_role;

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read incidents"
  ON public.incidents FOR SELECT TO authenticated USING (true);
