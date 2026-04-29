---
name: Internal Notes
description: Timestamped internal notes rendered inline within message threads, sorted chronologically with messages
type: feature
---
Internal notes are stored in `conversation_notes` (conversation_id + conversation_source + author + note_text + created_at).

Display: notes render INLINE within the message thread on the conversation detail page (Slack/Gmail/manual), interleaved chronologically with messages by `created_at` timestamp. They use a yellow-tinted card with a "Internal note" pill so they're visually distinct from customer/agent messages. Hover reveals a delete (X) button.

Composer: a compact yellow-tinted note composer renders below each thread (textarea + "Add note" button). ⌘+Enter shortcut to add. Author name is saved to `localStorage` under `note_author` and reused across sessions.

There is NO separate "Internal notes" tab anymore — the tab was removed when notes moved inline. Tabs below the thread are now: Reply to customer, Activity log.
