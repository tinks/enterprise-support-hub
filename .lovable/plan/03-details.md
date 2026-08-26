## Technical detail

### Notes migration (one migration, additive)

- Copy every non-empty `dev_escalations.note` into `public.conversation_notes` as `(conversation_id = intercom_tickets_v3.id, conversation_source = 'intercom_v3', author = 'Escalations (migrated)', note_text = note, created_at = dev_escalations.updated_at)`, joined on `intercom_conversation_id`. Guarded so re-running cannot duplicate.
- `dev_escalations.note` is left in place and stops being written — the rollback path.
- No schema change is needed: `conversation_notes` already carries `conversation_id uuid`, `conversation_source text`, `author`, `note_text`, and its RLS/grant set is the one the conversation detail page uses. Rows written from a v3 surface use `conversation_source = 'intercom_v3'`, the same value `src/lib/subjectDisplay.ts` already uses for v3 audit rows.

### Page rewrite — `src/pages/Escalations.tsx`

- Row model gains `hasLinear` (derived from the existing `resolveLinear`). Two derived arrays: `needsLinear` and `linked`.
- Segmented control (`Needs Linear · n` / `Linked · n` / `All`) replaces the five hub-state pills; hub-state, type, owner and customer filters collapse into a single compact filter row, with owner/customer moved behind a "More filters" popover.
- Table columns reduce to `idColumn`, `subjectColumn` (edit kept — it is a single click and already inline), `customerColumn`, Type, Linear (read-only chip + external-link icon), Hub state (kept inline; it is the one action people take from the list), `ageColumn`.
- `onRowClick` opens a shared `IssueDetailSheet` with `IssueField` rows for Contact, Owner, Intercom state, Linear key/title/state/assignee/synced-at, plus editable Linear override and Hub state, plus the notes thread.
- Info banner becomes a `Popover` on an info icon next to the title. Header keeps "Data as of", "Sync Linear" (edit-gated), and refresh.
- Search haystack keeps subject/contact/Intercom ID/Linear ref and swaps `esc.note` for the loaded conversation notes.

### New component — `src/components/issues/TicketNotes.tsx`

Reads and writes `conversation_notes` for a `(conversationUuid, 'intercom_v3')` pair: list oldest-first with author + timestamp, add via a textarea (⌘+Enter), delete own rows, author name reused from `localStorage.note_author` exactly as the conversation detail composer does. Writes gated on `useCanEdit()`.

Notes for the visible page are fetched in one batched query keyed by ticket uuid so the sheet opens with them already present.

### Docs and changelog

Per convention: `.lovable/project-knowledge.md` update staged through `sync-knowledge-pending`, a `changelog_entries` row, and the Escalations FlowDiagram node updated to say notes now live in `conversation_notes`.

### Not in scope

`sync-linear-escalations`, hub-state semantics, qualification rules, and Linear write-back are untouched. The legacy `ConversationDetail` page is not extended to v3 tickets in this pass — notes become portable data now; surfacing them on a v3 ticket detail page is a follow-up.
