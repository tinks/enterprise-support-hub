
# New Inbox (sandbox) — parallel path for cleaner field tracking

## Idea
Build a brand-new `/inbox-v2` page powered by its own table. It pulls Owner / Product Area / Classification from Intercom into that table only. Nothing on the existing Conversations / `/my/*` / Stats / Insights pages changes. Once we trust it, we flip the existing pages to read from the new table.

## Scope of this first iteration
- One new route: `/inbox-v2` (sidebar entry, labeled "Inbox v2 (beta)").
- One new table: `inbox_v2_tickets`.
- One new edge function: `sync-inbox-v2` (pulls from Intercom, writes only to `inbox_v2_tickets`).
- Read-only UI for now: list, filters, ticket detail drawer. No edit/reply yet.
- No changes to existing tables, existing functions, existing crons, existing pages.

Out of scope (deliberately): replacing the current Inbox, owner enforcement, the "needs triage" queue, reporting tiles, retiring local AI categorization. Those come later once v2 proves itself.

## Data model

New table `inbox_v2_tickets`, one row per Intercom conversation:

| column | type | source |
| --- | --- | --- |
| `id` | uuid pk | generated |
| `intercom_conversation_id` | text unique | Intercom |
| `subject` | text | Intercom `source.subject` / `title` |
| `contact_name` | text | Intercom contact |
| `contact_email` | text | Intercom contact |
| `owner` | text | `admin_owner_map[admin_assignee_id]` |
| `product_area` | text | `custom_attributes["Affected Product Area"]` |
| `classification` | text | `custom_attributes["Ticket type"]` |
| `status` | text | Intercom `state` (open / closed / snoozed) |
| `intercom_created_at` | timestamptz | Intercom |
| `intercom_updated_at` | timestamptz | Intercom |
| `last_synced_at` | timestamptz | now() on each sync |
| `raw_payload` | jsonb | full Intercom conversation JSON, for debugging |
| `created_at`, `updated_at` | timestamptz | standard |

RLS: SELECT for authenticated, ALL for service_role. No writes from the client.

Linking back to the existing world is intentionally deferred — `intercom_conversation_id` is the join key when we need it later.

## Sync function

`supabase/functions/sync-inbox-v2/index.ts`:
- Inputs: `{ windowHours?: number, full?: boolean }`. Default 24h.
- Reuses `extractIntercomCustomFields` and `admin_owner_map` logic already proven in `poll-intercom-inbox`.
- For each Intercom conversation in the window, upsert by `intercom_conversation_id`. Always overwrite Owner / Product Area / Classification with the latest Intercom value (including blanks — this table is Intercom's mirror, drift is the point).
- Idempotent. Logs counts inserted vs updated.

Cron: every 15 minutes via pg_cron + pg_net, plus a nightly 72h sweep. Both invoke the same function with different `windowHours`.

No webhook coupling in v1 — the cron is enough for a sandbox. Webhook integration can be added once we like the data.

## UI

`src/pages/InboxV2.tsx` rendered at `/inbox-v2`, added to `AppLayout` sidebar under a "Beta" group.

- Table columns: Subject, Contact, Owner, Product Area, Classification, Status, Updated.
- Filters in the top bar: Owner, Product Area, Classification, Status, and a "Missing field" multi-select (owner / product area / classification).
- Search box: subject + contact + email + intercom id.
- Row click opens a right-side drawer showing the cached Intercom fields plus a "View in Intercom" link (we already build that URL elsewhere). No reply UI.
- Small footer chip: "Last synced HH:mm — N tickets". A "Sync now" button calls the edge function (admin-only check via existing auth).

Styling: reuse existing shadcn components and the same density as `Conversations.tsx` so it feels familiar.

## How this de-risks the bigger plan
- Zero blast radius: no existing query, cron, function, page, or table is touched.
- We can compare v2 vs the current Conversations page side by side for a few weeks and see exactly where Intercom values differ from what we're storing today.
- Cutover later is a small change — point the existing Conversations / `/my/*` queries at `inbox_v2_tickets` (or a view that joins it) once you're happy. The hard work (Intercom field semantics, drift handling) is already validated by then.

## Files touched

- New: `supabase/functions/sync-inbox-v2/index.ts`.
- New: `src/pages/InboxV2.tsx`.
- Edit: `src/App.tsx` (one route).
- Edit: `src/components/AppLayout.tsx` (one sidebar entry).
- One migration: create `inbox_v2_tickets` + grants + RLS.
- One `supabase--insert` call: pg_cron schedule.
- New memory leaf: `mem://features/inbox-v2-sandbox` describing the parallel-path rule.
- Update `.lovable/project-knowledge.md` + Flow page with the new node.

## Open question before I build

Should "Sync now" be visible to everyone who can see the page, or gated to specific owners (e.g., you only)? Default in this plan: visible to all authenticated users since the page itself is admin-only anyway.
