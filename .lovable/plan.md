## Goal

`.lovable/project-knowledge.md` is missing several pieces of behavior that have shipped recently or that exist in memory but were never reflected in the canonical knowledge doc. This plan adds those pieces. No app behavior changes — documentation only.

Per the project rule, the change will be written to `knowledge_documents.pending_content` (with a `pending_summary`), not directly to `content`, so it shows up as a pending diff in `/knowledge` for approval. The committed `.lovable/project-knowledge.md` file will be updated in the same change so the static seed and the DB stay in sync.

## What's missing today

Comparing the current knowledge file against memory (`mem://index.md` and the per-feature/per-logic notes) and recent code changes, these gaps will be filled:

1. **Owners list out of date.** Section refers only to "Joel, Kristina" dashboards. Canonical list is now Joel, Kristina, Sam, CSM, Eren, Tine — with Eren scoped to SSO/SCIM contractor work. (Source: `mem://team/owners`, `src/components/AppLayout.tsx`.)

2. **Slack import auto-navigates to the new conversation.** After a successful Slack import in `ImportTab`, the UI navigates to `/conversations/:id?source=slack` so the user can immediately triage. Not documented anywhere in the knowledge file.

3. **Internal notes — two-source model.** The current "Intercom internal notes" section (§ at the bottom) only covers the Intercom-origin path. It should also describe user-authored notes stored in `conversation_notes` (inline composer below the thread, ⌘+Enter shortcut, hover-to-delete, `note_author` cached in `localStorage`), and clarify that both render as the same yellow card interleaved chronologically with messages. (Source: `mem://features/internal-notes`.)

4. **Manual-message dedup rule.** §10 mentions "Manual message idempotency" only in the context of Intercom firing two assignment topics. The general rule from `mem://logic/manual-message-dedup` — that any insert into `manual_messages` must dedup by `${role}|${floor(created_at_ms/1000)}|${message_text}` because the table has no DB-level uniqueness — should be promoted to its own short bullet so future ingestion paths follow it.

5. **Database tables list missing rows.** §2 "Database Tables" doesn't list:
   - `conversation_notes` (user-authored inline notes)
   - `conversation_audit_logs` (immutable old/new value history)
   - `pending_intercom_links` (deferred Intercom→Gmail linking escrow)
   These all exist in the schema and are referenced elsewhere in the doc.

6. **Edge functions list missing rows.** §2 "Edge Functions" is stale. Add (at minimum): `poll-gmail`, `poll-intercom-inbox`, `intercom-webhook` already present, `backfill-intercom-replies`, `backfill-enterprise-inbox`, `backfill-gmail-headers`, `backfill-slack-user-names`, `bulk-import-intercom`, `import-intercom-ticket`, `import-slack-thread`, `create-intercom-from-import`, `fetch-gmail-thread`, `fetch-thread-messages`, `gmail-auth-url`, `gmail-oauth-callback`, `parse-thread`, `post-reply`, `promote-pending-intercom-links`, `search-intercom-by-email`, `cleanup-bad-intercom-imports`, `delete-conversation-mapping`, `delete-slack-message`, `context-reminder`. One-line purpose each.

7. **UI pages list missing rows.** §2 "UI Pages" is missing `/login`, `/import` exists but `BulkImportReview` (`/import/review`) and `TestChannelReview` are not listed, and `FlowDiagram` is at `/flow` already listed. Add the missing routes from `src/App.tsx` after a quick read.

## Approach

1. Read `src/App.tsx` to confirm the exact route list before writing the new UI Pages table.
2. Read the current `content` from `knowledge_documents` (DB is the source of truth for the live doc).
3. Compose the updated markdown with the additions above. Keep all existing sections intact; only insert/extend.
4. `UPDATE knowledge_documents SET pending_content = ..., pending_summary = 'Backfill missing knowledge: owners, Slack-import auto-nav, two-source internal notes, manual_messages dedup rule, missing tables/functions/routes', pending_at = now() WHERE id = 'project-knowledge'`.
5. Also write the same updated markdown to `.lovable/project-knowledge.md` so the static seed matches once approved.
6. Tell the user the diff is waiting in `/knowledge` for review.

## Out of scope

- No edge function changes.
- No schema changes.
- No Flow diagram updates (no logic change to reflect).
- Memory files are already accurate; no edits there.
