---
name: Inbox v2 sandbox
description: Parallel /inbox-v2 page + inbox_v2_tickets table that mirrors Intercom as read-only source-of-truth sandbox
type: feature
---
Inbox v2 is a sandbox parallel to the live Inbox. Goal: validate Intercom-sourced Owner / Product Area / Classification without disturbing existing tables, crons, or pages.

- Route: `/inbox-v2` → `src/pages/InboxV2.tsx`. Sidebar entry uses the Beaker icon.
- Table: `public.inbox_v2_tickets`, one row per Intercom conversation, keyed by `intercom_conversation_id`. Authenticated users can read; only `service_role` writes. Columns include `tags text[]` mirroring Intercom conversation tag names.
- Sync: edge function `sync-inbox-v2`. Pulls conversations in the enterprise inbox updated within `windowHours` (default 24h). Owner from `admin_owner_map[admin_assignee_id]`; product_area from `custom_attributes["Affected Product Area"]`; classification from `custom_attributes["Ticket type"]`; tags from `icData.tags.tags[].name`. Unlike the live tables, this table DOES null-out / overwrite values when Intercom is blank — drift is the signal we want to see.
- Crons (pg_cron): `sync-inbox-v2-frequent` every 15 min (windowHours=2), `sync-inbox-v2-nightly` at 03:00 UTC (windowHours=720).
- UI is read-only: search + filters for Owner / Product Area / Classification / Status / Tags, with a "missing" option for the first three and a `(no tags)` option for tags. "Sync now" button invokes the function on demand. "View in Intercom" link in the detail drawer.
- UI is read-only: search + filters for Owner / Product Area / Classification / Status, with a "missing" option for the first three. "Sync now" button invokes the function on demand. "View in Intercom" link in the detail drawer.
- Nothing else in the app reads from `inbox_v2_tickets`. Cutover (Conversations/`/my/*` reading from this table) is a future step gated on user approval.

