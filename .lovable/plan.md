## Goal

Show internal notes inline within the message thread on the conversation detail page, interleaved chronologically with Slack/Gmail/manual messages — instead of (or in addition to) being tucked away in the "Internal notes" tab.

## Changes

### 1. Inline note rendering in the thread (`src/pages/ConversationDetail.tsx`)

In each of the three thread renderers (`renderSlackContent`, `renderGmailContent`, `renderManualContent`), build a unified timeline that merges:
- Existing messages (with their timestamps: `msg.ts` for Slack, `msg.date` for Gmail, `msg.created_at` for manual)
- `notes` from state (sorted by `created_at`)

Each timeline item is tagged `kind: "message" | "note"`, sorted ascending by timestamp, then rendered in order. Notes get a distinct visual treatment so they don't look like customer/agent messages:
- Subtle yellow/amber tinted card (`bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200`)
- Small "Internal note" label + author + relative timestamp
- Sentence-case copy throughout
- Hover-revealed delete (X) button — same behavior as today
- `whitespace-pre-wrap` text body

### 2. Quick-add input below the thread

Underneath each message list, add a compact inline note composer (textarea + "Add note" button + optional name field if `noteAuthor` is empty). It calls the existing `addNote()` — no logic change. ⌘+Enter shortcut preserved.

### 3. Tab cleanup

Remove the standalone "Internal notes" tab from the `Tabs` block (lines ~1025, 1068–1118). Notes now live in the thread + inline composer, so the tab is redundant. Tabs reduce to:
- Reply to customer
- Activity log

`defaultValue` becomes `"reply"` (unchanged).

### 4. State / data layer

No schema changes. `conversation_notes` table, `addNote`, `deleteNote`, and the fetch effect stay as-is. The `notes` array is now consumed inside the renderers instead of the tab.

### 5. Follow-up housekeeping

- Update `.lovable/project-knowledge.md` to note that internal notes render inline in the thread.
- Update `mem://features/internal-notes` to reflect the inline placement.
- No Flow page change needed (no logic flow shift, just UI placement).

## Technical detail

Timeline merge helper (per source), inside each renderer:

```ts
type TimelineItem =
  | { kind: "message"; ts: number; data: ThreadMessage }
  | { kind: "note"; ts: number; data: ConversationNote };

const items: TimelineItem[] = [
  ...threadMessages.map(m => ({ kind: "message" as const, ts: parseFloat(m.ts) * 1000, data: m })),
  ...notes.map(n => ({ kind: "note" as const, ts: new Date(n.created_at).getTime(), data: n })),
].sort((a, b) => a.ts - b.ts);
```

Equivalent for Gmail (`new Date(msg.date).getTime()`) and manual (`new Date(msg.created_at).getTime()`).

Render switch:

```tsx
items.map(item => item.kind === "message"
  ? <MessageBubble msg={item.data} />
  : <InlineNote note={item.data} onDelete={deleteNote} />)
```

`InlineNote` is a small inline component (or JSX block) inside `ConversationDetail.tsx` — no new file.
