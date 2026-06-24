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

- Nothing else in the app reads from `inbox_v2_tickets`. Cutover (Conversations/`/my/*` reading from this table) is a future step gated on user approval.

- CSV export: `ExportPopover` in `src/pages/InboxV2.tsx`. Date-range presets (7/14/30 days, This/Last month, Custom) + From/To inputs. Queries `inbox_v2_tickets` directly with `.gte/.lte('intercom_created_at', ...)`, paginated in 1000-row batches via `.range()` so it isn't capped by the 500-row table fetch. Owner/Product Area/Classification/Status filters apply server-side; Tags + free-text search + Engagement apply client-side post-fetch. CSV includes Created date and Engagement even though Created isn't a visible table column.

- Engagement classification: a ticket is "No engagement" if its `tags` include `enterprise-fyi` or `enterprise-duplicate` (case-insensitive, trimmed). Derived client-side via `isNoEngagement()` in `src/pages/InboxV2.tsx` — no schema or sync change. Surfaced as: (1) an "Engagement" table column with a badge, (2) an "Engagement: any / Engaged / No engagement" filter dropdown, (3) an "Engagement" column in the CSV export. To change the trigger tags, edit the `NO_ENGAGEMENT_TAGS` set at the top of `InboxV2.tsx`.
