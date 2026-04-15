

## One-time backfill: sync missed Intercom replies into manual_messages

### Problem
Many `manual_conversations` (imported from Intercom) only have their initial messages but are missing subsequent replies. The webhook wasn't tracking replies for these conversations until recently. Status fields are also stale.

### Scope
- **98 manual conversations** with `source = 'intercom'` that have an `intercom_conversation_id`
- **~197 Slack conversation_mappings** with Intercom links (status-only, no message backfill needed)
- **~63 Gmail conversations** with Intercom links (status-only, no message backfill needed)

### Solution
Create a one-time edge function `backfill-intercom-replies` that:

1. Fetches all `manual_conversations` where `intercom_conversation_id IS NOT NULL`
2. For each conversation:
   - Fetches the full Intercom conversation (with paginated parts)
   - Extracts all non-bot, non-note, non-open/close parts with body text
   - Fetches existing `manual_messages` for that conversation
   - Compares by `created_at` timestamp (rounded to second) to find missing messages
   - Inserts missing messages with correct `sender_name`, `role`, and `created_at`
   - Updates conversation `status` based on the latest reply author (admin → `awaiting_customer`, user → `awaiting_support`)
   - If the Intercom conversation is closed and our status isn't `resolved`, marks it resolved
3. Returns a summary of what was backfilled

Also updates `gmail_conversations` and `conversation_mappings` statuses based on current Intercom state (open/closed/snoozed).

### Changes

**New file: `supabase/functions/backfill-intercom-replies/index.ts`**
- Reuses the same Intercom fetch + pagination logic from `import-intercom-ticket`
- Processes conversations in batches to avoid timeout (configurable limit, default 20)
- Accepts optional `?offset=N` query param for manual pagination
- Dry-run mode with `?dry=true` to preview changes without writing
- Logs each conversation processed with counts of new messages found

**File: `src/pages/FlowDiagram.tsx`**
- No changes needed (this is a one-time script, not a permanent flow change)

### Technical detail
```text
For each manual_conversation with intercom_conversation_id:
  1. GET /conversations/{id} (paginate parts)
  2. Extract parts: skip bot, note, open, close, away_mode_assignment
  3. SELECT existing manual_messages by conversation_id
  4. Diff by created_at (epoch second match) to find missing
  5. INSERT missing messages
  6. UPDATE status if Intercom state differs

Rate limiting: ~1 Intercom API call per conversation + pagination
Timeout safety: process max 20 per invocation, use offset for batches
```

### Files to create/edit
- `supabase/functions/backfill-intercom-replies/index.ts` — new one-time backfill script

