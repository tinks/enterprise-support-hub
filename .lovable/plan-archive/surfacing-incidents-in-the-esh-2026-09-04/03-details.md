## Build steps

### 1. Connect incident.io

Link the incident.io connector to this project (a connect card in chat; you pick or create the connection). The API key needs read access to incidents. If it comes back without permission, the plan halts here and I tell you — I will not silently fall back to Slack parsing.

### 2. Data model (SQL — yours to review)

New table `public.incidents`, one row per incident, keyed on the incident.io id:

- identity: `external_id` (unique), `reference` (INC-1907), `incident_number`
- content: `name`, `summary`
- classification: `severity_name`, `severity_rank`, `status`, `status_category` (live / closed), `incident_type`
- impact: `is_customer_impacting` (true when a public status page entry or public visibility exists), `status_page_url`
- timing: `opened_at`, `resolved_at`, `closed_at`, `last_synced_at`
- links: `incident_url`, `slack_channel_id`, `slack_channel_name`
- `raw` jsonb of the API payload, so a later phase can derive fields without a re-fetch

GRANTs plus RLS: `SELECT` to authenticated, writes to service role only. No trigger touches any v3 table — incidents are a standalone dimension in phase 1.

### 3. `sync-incidents` edge function

- Gated with `requireEditorOrSecret`, same pattern as `poll-slack-closed-won`.
- Calls the gateway `GET /v2/incidents` with cursor pagination; upserts on `external_id` so re-runs are idempotent.
- Two modes: `recent` (default, last N days plus every incident not yet closed) and `full` (paginate to a start date, for the initial backfill).
- Records `integration_health` under `incidentio_sync`, so a revoked key surfaces in Settings → Integration health instead of a frozen banner.
- Backs off on 429/5xx, stops on 401/403 with a clear message.
- Cron: every 5 minutes for `recent`. That is the banner's staleness ceiling, stated plainly in the UI ("as of hh:mm").

### 4. Live banner

A component in `AppLayout`, rendered only when at least one incident has `status_category = 'live'`. Shows severity chip, title, status, age, and links to the incident channel and incident.io. Collapses to a single line when several are open, expandable. Dismissible for the session only — it returns on reload, since it is context, not a notification.

### 5. `/incidents` page

Sortable table using the existing `useTableSort` convention and 140px fixed columns: reference, title, severity, status, customer-impacting, opened, closed, duration, links. Filters for severity, status, customer-impacting, and date range. Nav entry in the sidebar, alphabetical.

### 6. Verification before I call it done

- Row count from the API vs rows in the table, stated numerically.
- One incident that changed status between two syncs, shown before and after, to prove edits land rather than duplicate.
- Negative cases run and named: a revoked/invalid key (health goes red, banner shows stale rather than empty), an incident with no status page (flag stays false), and zero live incidents (banner absent, not an empty bar).
- Anything I cannot run gets marked UNVERIFIED.

### 7. Documentation

`.lovable/project-knowledge.md` staged through `sync-knowledge-pending` for your approval, a `changelog_entries` row, and a FlowDiagram node for the incident sync path.

## Deliberately out of scope for phase 1

- Linking a ticket to an incident, and "tickets caused by incidents" counts.
- Overlaying incident windows on volume/trend charts and the Monthly Lookback.

Both are natural phase 2 and both are easier once the table exists — but neither is built here.

## If the API key is unavailable

Fallback only: a `poll-slack-incidents` function reading C07TMQ5E6SC on a 5-minute cron, parsing the incident.io announcement blocks (title, `[Severity]` prefix, status line, incident number from the homepage URL, status page link) and upserting into the same table on incident number. Same schema, same UI, lower fidelity — no resolved/closed timestamps beyond the last edit time. I would tell you before taking this path, not after.
