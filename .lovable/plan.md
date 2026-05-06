## Goal

On the conversation detail page (`/conversations/:id`), make the body text of:
1. **Messages** in the Messages thread (`manual_messages.message_text`)
2. **Internal notes** — both sources:
   - User-authored notes (`conversation_notes.note_text`)
   - Intercom-origin notes (`manual_messages` rows with `is_internal_note = true`)

editable inline, with Save / Cancel.

Author/sender, role, and timestamp stay read-only — only the body text is editable.

## UX

- Hovering a message or note reveals a small **pencil** icon (next to the existing delete X on notes).
- Clicking pencil swaps the `<p>` for a `<Textarea>` pre-filled with current text, plus **Save** and **Cancel** buttons.
- ⌘/Ctrl+Enter saves; Esc cancels.
- On save: optimistic update, then `supabase.update(...)` on the relevant table. On error, revert and `toast.error`.
- Empty text is rejected (toast + stay in edit mode).
- Yellow internal-note styling is preserved in edit mode (textarea inherits the yellow background classes).

## Where

All changes in `src/pages/ConversationDetail.tsx`:

1. Add `editingMessageId`, `editingNoteId`, `editDraft` state.
2. Add `saveMessageEdit(id)` → `update({ message_text }).eq('id', id)` on `manual_messages`, then refresh local state.
3. Add `saveNoteEdit(id)` → `update({ note_text }).eq('id', id)` on `conversation_notes`. (Add a permissive RLS update policy — see DB section.)
4. Refactor the three render branches in `renderManualContent()` (regular message, internal-note from messages) and `renderInlineNote()` to render a small inline editor when `editing*Id === item.id`.
5. Pencil icon uses `lucide-react`'s `Pencil` (already used elsewhere in the codebase if available, otherwise import).

## Database

`conversation_notes` currently has no UPDATE RLS policy (only SELECT/INSERT/DELETE). Add:

```sql
CREATE POLICY "Allow authenticated update conversation_notes"
ON public.conversation_notes
FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);
```

`manual_messages` already has an authenticated UPDATE policy — no migration needed.

## Audit log

Optional but consistent with existing patterns: write a `conversation_audit_logs` row on edit with `action='message_edited'` / `'note_edited'`, `old_value`, `new_value`. Skip unless you want it — not asked for explicitly. **Default: skip** to keep the change small; mention to user.

## Memory

Update `mem://features/internal-notes.md` to note that both note sources and manual messages now support inline editing (body text only).

## Files

- Edit `src/pages/ConversationDetail.tsx`
- New migration adding UPDATE policy on `conversation_notes`
- Edit `mem://features/internal-notes.md`
- Edit `.lovable/project-knowledge.md` (per project rule about logic-change tracking)
