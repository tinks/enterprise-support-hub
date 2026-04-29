---
name: Internal Notes
description: Two sources of inline internal notes (user-authored in conversation_notes; Intercom-origin in manual_messages with is_internal_note flag), both rendered as yellow cards interleaved chronologically in the message thread.
type: feature
---
There are TWO sources of internal notes, both rendered with the same yellow "Internal note" card style, interleaved chronologically with messages on the conversation detail page:

1. **User-authored notes** — stored in `conversation_notes` (conversation_id + conversation_source + author + note_text + created_at). Created via the inline composer below the thread on the detail page. Hover reveals a delete (X) button. Author name is saved to `localStorage` under `note_author` and reused across sessions. ⌘+Enter shortcut to add.

2. **Intercom-origin notes** — Intercom conversation parts with `part_type === "note"` are ingested into `manual_messages` with `is_internal_note = true` (column added 2026-04). All Intercom ingestion paths handle this: `import-intercom-ticket`, `backfill-intercom-replies`, `poll-intercom-inbox`, `backfill-enterprise-inbox`, `bulk-import-intercom`, and `intercom-webhook` (live, including `conversation.admin.noted` topic). Notes don't change the customer-facing status. Read-only — no UI to delete or post back to Intercom. The `backfill-intercom-replies` dedup key is `epoch:is_internal_note` so a note posted at the same second as a reply isn't suppressed.

There is NO separate "Internal notes" tab — tabs below the thread are: Reply to customer, Activity log.
