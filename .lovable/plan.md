## Goal

Stop pulling Intercom conversations from inboxes other than the configured enterprise inbox (currently `8484447`), unless the user explicitly forces it. Then sweep historical rows that don't belong and flag them as `is_test=true` so they drop out of Insights/analytics but remain viewable.

## 1. Add inbox guard to manual import paths

### `supabase/functions/import-intercom-ticket/index.ts` (single URL paste)
After fetching the conversation from Intercom and before the duplicate checks/insert:
- Read `settings.intercom_inbox_id`.
- Compare `icData.team_assignee_id` (string) to the configured inbox ID. If team is missing, also re-fetch via `/conversations/{id}` (already have it) — use `team_assignee_id` from the fetched payload.
- If mismatch and `force !== true`: return HTTP `409` with `{ error: "not_in_enterprise_inbox", currentTeamId, enterpriseInboxId, intercomConversationId }`.
- If mismatch and `force === true`: proceed and log a warning.

### `supabase/functions/bulk-import-intercom/index.ts` (CSV / batch)
Same check per conversation. Add to the per-row result:
- On mismatch without `force`: skip the row and include `{ skipped: true, reason: "not_in_enterprise_inbox", currentTeamId }` in the result summary.
- Accept a top-level `force: true` body flag to override for the whole batch.

### UI changes
- **Single URL paste form** (Import page): when the function returns `not_in_enterprise_inbox`, surface a confirmation dialog: *"This Intercom ticket is currently in team `{currentTeamId}`, not your enterprise inbox (`{enterpriseInboxId}`). Import anyway?"* → on confirm, retry with `force: true`.
- **Bulk import**: show a per-row warning chip "Outside enterprise inbox" plus a single "Import all anyway" button at the top that retries the failed rows with `force: true`.

No new tables. No new columns.

## 2. One-time cleanup tool

New edge function `audit-out-of-inbox-tickets` (admin-only via Settings page):

- Loads `settings.intercom_inbox_id`.
- Iterates all rows from `manual_conversations`, `gmail_conversations`, and `conversation_mappings` where `intercom_conversation_id IS NOT NULL` and `is_test = false`.
- For each, calls `GET /conversations/{id}` (Intercom). Throttled (e.g. 5 req/sec) to respect rate limits. Caches results.
- Compares `team_assignee_id` to the enterprise inbox ID.
- **Dry-run mode** (default): returns a JSON report `{ checked, mismatches: [{ table, id, intercomId, currentTeamId, subject, contact }] }`. No writes.
- **Apply mode** (`{ apply: true }`): updates `is_test = true` on every mismatched row across all 3 tables. Writes a `conversation_audit_logs` entry per row (`action: "flagged_out_of_inbox"`, `old_value: "false"`, `new_value: "true"`, `performed_by: "audit-out-of-inbox-tickets"`).

### Settings page UI
Add an "Inbox audit" card (next to existing maintenance tools):
- Button **"Scan for out-of-inbox tickets"** → calls dry-run, shows a count + table preview.
- Button **"Flag all as test"** (red, with confirmation) → calls apply mode, shows result counts.

## 3. Memory + project-knowledge updates

- New memory file `mem://logic/enterprise-inbox-guard` describing: import paths that enforce the guard, override mechanism, audit tool.
- Update `mem://index.md` Core to mention: "Manual Intercom imports validate `team_assignee_id == intercom_inbox_id`; `force=true` overrides".
- Update `.lovable/project-knowledge.md` with the new audit tool + guard.
- Update Flow page (`src/pages/FlowDiagram.tsx`) — add a guard node between "Manual import" and "Insert into manual_conversations".

## Out of scope

- The Gmail/Google Group `pending_intercom_links` path (#5/#6 from the earlier table). Those legitimately need to link to Intercom regardless of current team because the Google Group inbox often re-routes. Can be a separate hardening pass if you want.
- Periodic re-validation of already-imported tickets (e.g. the ticket *was* in enterprise inbox at import time but got moved later). The audit tool can be re-run manually to catch these.

## Files affected

- `supabase/functions/import-intercom-ticket/index.ts` (edit)
- `supabase/functions/bulk-import-intercom/index.ts` (edit)
- `supabase/functions/audit-out-of-inbox-tickets/index.ts` (new)
- `src/pages/ImportPage.tsx` and/or `src/components/ImportTab.tsx` (force-confirm dialog)
- `src/pages/BulkImportReview.tsx` (per-row warning + bulk override)
- Settings page (likely `src/pages/Stats.tsx` or wherever maintenance tools live — will confirm during implementation) — add Inbox audit card
- `src/pages/FlowDiagram.tsx` (new node)
- `.lovable/project-knowledge.md`
- `.lovable/memory/index.md` + new `logic/enterprise-inbox-guard.md`
