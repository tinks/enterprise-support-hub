# Surfacing incidents in the ESH

## What the channel actually contains

I read the last posts in `#incidents` (C07TMQ5E6SC). Every post is an incident.io announcement, edited in place as the incident moves: title, severity prefix (`[Major]`), status (Investigating / Fixing / Reviewing), the incident's own Slack channel, an incident.io homepage link with the incident number (e.g. 1907), and — only for customer-facing ones — a public status page link.

That is enough to build from, but it is a rendered summary. The incident.io API carries the same incidents as structured records: severity object, status category, created/resolved/closed timestamps, incident type, custom fields, and updates.

## On your question: how real-time is Slack polling?

Polling is only as fresh as its schedule. A 5-minute cron means a banner can be up to 5 minutes stale, and because incident.io *edits* the original post rather than posting again, a poller has to re-read a rolling window every run and diff — otherwise status changes are missed entirely. Slack event subscriptions would be near-instant but need `message_changed` handling and the bot sitting in the channel.

The incident.io API has the same freshness ceiling (it is also polled), but each poll is cheap, exact, and needs no block-parsing. Given the connector already exists, going straight to the API is less work than the Slack path, not more.

**Recommendation: skip the Slack phase entirely. Build on the incident.io connector as phase 1.** Slack stays as a documented fallback if the API key turns out to be unobtainable.

## What you get

Two surfaces, matching what you picked:

1. **Live banner** — a thin strip at the top of the hub listing incidents that are open right now, with severity, status, age, and a link straight to the incident channel or incident.io. Visible while triaging, gone when nothing is active.
2. **Incidents log** — `/incidents`, a sortable table of every incident ingested: reference, title, severity, status, customer-impacting flag, opened, closed, duration, links out. Filterable by severity, status, customer-impacting and date range.

Everything is ingested; customer-impacting is a flag derived from the public status page presence (and, from the API, the incident's visibility field), not a filter at ingest.
