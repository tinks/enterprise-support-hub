---
name: Inbox v2 sandbox
description: Parallel /inbox-v2 page + inbox_v2_tickets table that mirrors Intercom as read-only source-of-truth sandbox
type: feature
---
Inbox v2 is a sandbox parallel to the live Inbox. Goal: validate Intercom-sourced Owner / Product Area / Classification without disturbing existing tables, crons, or pages.

- Route: `/inbox-v2` → `src/pages/InboxV2.tsx`. Sidebar entry uses the Beaker icon.
- Table: `public.inbox_v2_tickets`, one row per Intercom conversation, keyed by `intercom_conversation_id`. Authenticated users can read AND update (override columns); only `service_role` runs the sync writes. Columns include `tags text[]` mirroring Intercom conversation tag names.
- Sync: edge function `sync-inbox-v2`. Pulls conversations in the enterprise inbox updated within `windowHours` (default 24h). Owner from `admin_owner_map[admin_assignee_id]`; product_area from `custom_attributes["Affected Product Area"]`; classification from `custom_attributes["Ticket type"]`; tags from `icData.tags.tags[].name`. Unlike the live tables, this table DOES null-out / overwrite values when Intercom is blank — drift is the signal we want to see. The sync upsert lists explicit columns and therefore **never touches engagement override / AI columns**.
- Crons (pg_cron): `sync-inbox-v2-frequent` every 15 min (windowHours=2), `sync-inbox-v2-nightly` at 03:00 UTC (windowHours=720).
- Integration health: `sync-inbox-v2` writes the `inbox_v2_sync` key to `integration_health` (ok on success, auth_error/error on Intercom search failures). Surfaced in Settings → Integration health (30-min stale window) and alerted via `integration-health-alert` to `#enterprise-support-hub-alerts`.
- UI is read-only for Intercom-sourced fields. Engagement is editable (override + AI guess). Filters for Owner / Product Area / Classification / Status / Tags, with a "missing" option for the first three and a `(no tags)` option for tags. "Sync now" button invokes the function on demand. "View in Intercom" link in the detail drawer.
- Nothing else in the app reads from `inbox_v2_tickets`. Cutover (Conversations/`/my/*` reading from this table) is a future step gated on user approval.
- CSV export: `ExportPopover` in `src/pages/InboxV2.tsx`. Date-range presets (7/14/30 days, This/Last month, Custom) + From/To inputs. Queries `inbox_v2_tickets` directly with `.gte/.lte('intercom_created_at', ...)`, paginated in 1000-row batches via `.range()`. Owner/Product Area/Classification/Status filters apply server-side; Tags + free-text search + Engagement apply client-side post-fetch. CSV includes Engagement (effective), Engagement source, Engagement override, Engagement AI guess, Engagement AI reason.

## Engagement classification

Engagement is computed as **effective value + source** with this priority:

1. `engagement_override` (`'engaged' | 'none'`) — manual user override; wins over everything. Tracked with `engagement_override_at`.
2. `engagement_ai_guess` (`'engaged' | 'none'`) — set by the `classify-inbox-v2-engagement` edge function. Tracked with `engagement_ai_reason` (short one-liner shown in tooltip) and `engagement_ai_at`.
3. Tag-derived: `'none'` if `tags` contains `enterprise-fyi` or `enterprise-duplicate` (case-insensitive, trimmed).
4. Otherwise `'engaged'`.

Helpers `effectiveEngagement(ticket)` and `hasNoEngagementTag(tags)` live at the top of `InboxV2.tsx`. To change the trigger tags, edit the `NO_ENGAGEMENT_TAGS` set.

UI surfaces:
- **Engagement column** — inline Select (`Auto (tag/AI)` / `Engaged` / `No engagement`) writes `engagement_override` directly to the table. Picking Auto clears it. A small source chip (`manual` / `AI` / `tag` / `default`) sits next to the badge; tooltip shows the AI reason when source is `ai`.
- **Per-row Sparkles button** — runs the classifier for that single ticket.
- **"AI-classify visible" toolbar button** — runs the classifier (capped at 50 per click) on currently-filtered rows that have no override and no AI guess yet.
- **Engagement filter** — filters on effective value.

## AI classifier (`classify-inbox-v2-engagement`)

- Input: `{ ticketIds: string[] }` (1..50).
- Fetches each Intercom conversation with `?display_as=plaintext`, extracts the source message + non-note conversation parts (admin + user), trims to ~12k chars.
- Calls Lovable AI Gateway (`google/gemini-2.5-flash`, `response_format: json_object`) with a prompt that defines "none" as support cc'd / informed with no substantive work and "engaged" as anything that moved the ticket forward.
- Writes `engagement_ai_guess`, `engagement_ai_reason`, `engagement_ai_at`. Never touches `engagement_override`.
- On-demand only — no cron.
