

## Add internal notes to conversations

### What it does
Adds an "Internal notes" section below the messages on every conversation detail page. Team members can leave timestamped notes visible only to internal users — useful for tracking context, decisions, or handoff info.

### Changes

**Database migration** — create `conversation_notes` table:
```sql
CREATE TABLE conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  conversation_source text NOT NULL DEFAULT 'slack',
  author text NOT NULL DEFAULT '',
  note_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read conversation_notes" ON conversation_notes FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert conversation_notes" ON conversation_notes FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public delete conversation_notes" ON conversation_notes FOR DELETE TO public USING (true);

CREATE INDEX idx_conversation_notes_lookup ON conversation_notes (conversation_id, conversation_source);
```

**`src/pages/ConversationDetail.tsx`**
- Add state for notes list, new note text, and author name
- On load, fetch notes from `conversation_notes` where `conversation_id` and `conversation_source` match
- Render an "Internal notes" card below the messages section (left panel) with:
  - List of existing notes showing author, timestamp, and text
  - Delete button (x) on each note
  - Input area at the bottom: author text field + note textarea + "Add note" button
- Insert new notes into `conversation_notes` on submit

**`src/pages/FlowDiagram.tsx`** — note that internal notes are available on conversation detail pages

### Technical details
- `conversation_source` stores "slack", "gmail", or "manual" to scope notes correctly since IDs aren't globally unique across tables
- No authentication required — matches existing app pattern (public RLS)
- Notes are ordered by `created_at` ascending
- Author field remembers last used value via localStorage

### Files to edit
- Database migration — new `conversation_notes` table
- `src/pages/ConversationDetail.tsx` — notes UI
- `src/pages/FlowDiagram.tsx` — update flow notes

