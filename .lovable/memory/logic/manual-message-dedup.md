---
name: Manual message deduplication
description: Inserts into manual_messages must dedup by (conversation_id, role, content, second-precision created_at) because Intercom fires multiple assignment topics per event
type: feature
---

Intercom fires both `conversation.admin.assigned` and `conversation.admin.open.assigned` for the same logical assignment event, ~1s apart. Both reach `intercom-webhook` and run the auto-import path concurrently.

`manual_conversations` is safe — upsert with `onConflict: "intercom_conversation_id"` collapses both into one row.

`manual_messages` has no DB-level uniqueness. Both invocations would insert the full pre-extracted message list, causing every original message to land twice with identical `created_at`.

**Rule:** Before inserting into `manual_messages`, fetch existing rows for the conversation and filter incoming messages by key `${role}|${floor(created_at_ms/1000)}|${message_text}`. Drop any whose key already exists.

Applied in:
- `supabase/functions/intercom-webhook/index.ts` (auto-import path, around line 568)
- `supabase/functions/poll-intercom-inbox/index.ts` (around line 355)

Not needed in `backfill-intercom-replies` — already does epoch-based dedup.
