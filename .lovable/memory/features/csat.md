---
name: Intercom CSAT
description: Capture and display Intercom conversation_rating (1-5 + remark) on manual + gmail conversations
type: feature
---

Intercom CSAT (`conversation_rating`) is stored on both `manual_conversations` and `gmail_conversations` as `csat_rating smallint`, `csat_remark text`, `csat_rated_at timestamptz`. A `validate_csat_rating` trigger enforces 1–5.

Capture: imports (`import-intercom-ticket`, `bulk-import-intercom`) write CSAT on insert. Ongoing capture is via the `refresh-intercom-csat` edge function, scheduled every 6h via pg_cron (`refresh-intercom-csat-6h`) with `?mode=recent` (last 14 days resolved). For one-time historical sweep call `?mode=backfill`. The poll/webhook hot paths intentionally do not handle CSAT — ratings arrive long after resolution.

Stats UI: `/stats` "Customer satisfaction" card — avg score, total ratings, response rate (ratings / resolved Intercom-linked in scope), 1–5 distribution bar chart, recent 1–2★ list with click-through to conversation detail. Respects existing date / source / channel filters via `filteredManual` and `filteredGmailThreads`.
