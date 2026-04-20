---
name: Intercom Routing
description: Assignment handlers, polling reconciliation, and 5-minute pg_cron schedule for enterprise inbox tracking
type: feature
---
All Slack-initiated conversations are assigned to the AI agent (Sam) and enterprise inbox upon creation. The `intercom-webhook` imports tickets in real time on assignment events, with a strict `team_assignee_id == enterpriseInboxId` guard.

The `poll-intercom-inbox` edge function runs automatically every 5 minutes via pg_cron (job: `poll-intercom-inbox-every-5min`, schedule `*/5 * * * *`) as a catch-all for any tickets the webhook missed. It uses `last_polled_intercom_at` as a cursor for incremental polling. Also triggerable manually from the Settings page.
