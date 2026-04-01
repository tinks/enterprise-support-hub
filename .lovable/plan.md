

## Group Gmail emails by matching subject in conversations table

### What it does
Gmail emails that share the same `gmail_thread_id` (or matching `subject` when thread ID is null) will be visually grouped together in the conversations table. Instead of showing each email as a separate row, emails in the same thread collapse into a single expandable row showing the count and latest date.

### Changes

**`src/pages/Conversations.tsx`**

1. In the `unified` useMemo, after collecting Gmail rows, group them by `gmail_thread_id` (when non-null) or normalized `subject` (lowercase, trimmed, stripped of "Re:"/"Fwd:" prefixes). Each group becomes a single `UnifiedRow` with `source: "gmail"` using the most recent email as the primary `data`, plus a new field for the grouped children and count.

2. Extend the `UnifiedRow` gmail variant to include optional `groupedEmails: GmailConversation[]` and `groupCount: number` fields.

3. In `renderGmailCell`:
   - For the `"id"` column: show count badge (e.g. "3 emails") when `groupCount > 1`
   - For the `"message"` column: show the shared subject with the count
   - For the `"date"` column: show the latest received date, with the range if multiple
   - For the `"sent_by"` column: show the unique senders (e.g. "John + 2 others")

4. Add expand/collapse state (`expandedGmailGroups: Set<string>`) — clicking a grouped Gmail row toggles showing the individual emails as sub-rows beneath it, slightly indented.

5. In the table body rendering, when a Gmail row has `groupCount > 1` and is expanded, render the child rows immediately after the parent row with a subtle left-border indent styling.

**`src/pages/FlowDiagram.tsx`** — Document that Gmail emails with matching thread ID or subject are grouped in the conversations table.

### Files to edit
- `src/pages/Conversations.tsx` — grouping logic, expand/collapse UI
- `src/pages/FlowDiagram.tsx` — document change

