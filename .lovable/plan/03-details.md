## Technical detail

### Migration — one new table

`public.dev_escalations`

| column | notes |
| --- | --- |
| `id` | uuid pk |
| `intercom_conversation_id` | text, UNIQUE — the join key to `intercom_tickets_v3` |
| `hub_state` | text, default `open`, CHECK in (`open`,`in_progress`,`fix_shipped`,`customer_notified`,`wont_do`) |
| `linear_url_override` | text, nullable — beats the Intercom attribute when set |
| `note` | text, nullable |
| `owner` | text, nullable |
| `state_changed_at` / `notified_at` | timestamptz, nullable |
| `linear_key`, `linear_title`, `linear_state`, `linear_assignee`, `linear_synced_at` | nullable — phase-2 connector cache, unused for now |
| `created_by`, `created_at`, `updated_at` | standard, with the shared `update_updated_at_column` trigger |

GRANTs to `authenticated` (select/insert/update) and `service_role`; RLS mirroring `esh_backlog_items` — any authenticated user reads and writes, DELETE admin-only.

### Page

New `src/pages/Escalations.tsx`, route `/escalations`, added to the **Issues** flyout in `AppLayout.tsx` next to Triage.

- Candidate query: `intercom_tickets_v3` where `custom_attributes->>'Ticket type'` in (`Bug`,`Feature Request`), excluding `lifecycle_status = 'transferred_out'` and `customer_resolution_method = 'not_enterprise'`; joined client-side to all `dev_escalations` rows.
- Columns: Type badge · Subject (links to Intercom) · Customer · Owner · Severity · Intercom state (informational only) · Linear (link + key, `—` when absent) · Hub state (inline select) · Age since `intercom_created_at` · Note.
- Sort oldest-first within hub state; grouped/segmented by hub state with counts in the header, matching the Triage table's density and ultrawide column behaviour.
- Filters: hub state (default excludes `customer_notified` / `wont_do`), type, owner, customer, and free-text search.
- Writes: changing hub state, pasting a Linear override, or saving a note upserts on `intercom_conversation_id` and stamps `state_changed_at` (and `notified_at` when moving to `customer_notified`).

### Phase-2 hook (not built now)

`sync-linear-escalations` edge function: reads rows with a resolvable Linear key, one GraphQL query through the Linear connector gateway, writes `linear_state`/`linear_title`/`linear_assignee`/`linear_synced_at`. Cron hourly. Requires linking a Linear connection to the project first.

### Docs

Per convention: `.lovable/project-knowledge.md` update routed through `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node for the board.
