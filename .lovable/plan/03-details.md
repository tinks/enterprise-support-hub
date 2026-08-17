## Technical details

### Migration 1 — enum
`ALTER TYPE public.app_role ADD VALUE 'editor';` (must be its own migration; a new enum value cannot be used in the same transaction that adds it).

### Migration 2 — helper + backfill + policies
- `public.can_edit(_uid uuid) returns boolean` — security definer, `stable`, returns `has_role(_uid,'editor') or has_role(_uid,'admin')`.
- Backfill: insert `editor` rows for every existing `auth.users` id (2 admins get it too, harmless), so no current workflow breaks.
- Rewrite the 32 permissive write policies (INSERT/UPDATE/DELETE/ALL) across `bot_messages`, `changelog_entries`, `conversation_audit_logs`, `conversation_mappings`, `conversation_notes`, `dev_escalations`, `esh_backlog_items`, `flow_node_positions`, `gmail_conversations`, `inbox_v2_tickets`, `intercom_tickets_v3`, `knowledge_documents`, `manual_conversations`, `manual_messages`, `monthly_insights`, `settings`, `slack_channel_account_map`, `teammates`, and the v3 lookup tables to `USING (public.can_edit(auth.uid()))` / `WITH CHECK (...)`. Existing `has_role(...,'admin')` policies are left alone. `Deny public ...` (`false`) policies are left alone.
- Grants are unchanged — RLS carries the restriction.

### Edge functions
Add a `requireEditor` helper beside `_shared/require-user.ts` that calls `has_role` twice (or `can_edit`) with the caller's uid and returns 403 otherwise. Apply to the user-invoked mutators only: `esh-write-action`, `post-reply`, `delete-conversation-mapping`, `delete-slack-message`, `create-intercom-from-import`, `import-intercom-ticket`, `import-slack-thread`, `bulk-import-*`, `sync-knowledge-pending`. Before applying, each candidate is checked against `cron.job` commands; anything a cron job invokes is skipped and noted, exactly as in the earlier security batches.

### Frontend
- `src/hooks/useCanEdit.ts` — same shape as `useIsAdmin`, queries `user_roles` for `editor`/`admin`.
- `AppLayout` nav gains `editorOnly` on Triage, Dev escalations, Backlog, Import, Flow, Knowledge; existing `adminOnly` entries stay as-is.
- Write controls guarded by `canEdit`: severity write control, issue detail sheet edits, notes composer, reply box, registry/channel-map editors, backlog inline edits, escalation state changes, changelog add. Read-only users see the value, not the control.
- `RolesCard` on Admin → Users: an Editor badge plus Grant/Revoke editor, mirroring the admin buttons. No last-editor guard needed (admins always retain write).

### Verification before calling it done
1. Sign a real non-role account into the preview and confirm: reports render, every write control is absent, a direct `update` from the console returns an RLS error, and `esh-write-action` returns 403.
2. Sign in as an editor and confirm an actual write still succeeds (severity write on a "mine" test ticket, reverted after).
3. Re-run the cron inventory to show zero jobs hit a newly guarded function.
4. Docs pass: changelog row, a `roles-editor` node on `/flow`, and a project-knowledge section staged via `sync-knowledge-pending`.
