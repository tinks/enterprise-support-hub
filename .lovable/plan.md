

## Poll Intercom enterprise inbox for missed conversations

### Problem
Intercom webhook delivery is not 100% reliable. Conversation `215473900654421` was assigned to the enterprise inbox by the "Routing Enterprise" workflow, but no webhook was ever received. The system only tracks conversations reactively via webhooks, so dropped deliveries create gaps.

### Solution
Create a periodic **Intercom inbox poller** edge function (similar to how `poll-gmail` works) that:

1. Queries the Intercom Search API for recent conversations assigned to the enterprise inbox
2. Checks each against the three conversation tables (`conversation_mappings`, `gmail_conversations`, `manual_conversations`)
3. Auto-imports any untracked conversations using the same logic as the webhook assignment handler (including Gmail cross-referencing)

This function can be invoked manually from the app or scheduled via a cron trigger.

### Changes

**New file: `supabase/functions/poll-intercom-inbox/index.ts`**
- Use the Intercom Search Conversations API (`POST /conversations/search`) to find conversations where `team_assignee_id` matches the enterprise inbox, ordered by `updated_at` descending, limited to the last 24-48 hours
- For each conversation, check if `intercom_conversation_id` already exists in any of the three tables
- If not tracked: extract contact email, cross-reference Gmail, then create a `manual_conversations` entry (same logic as the webhook handler)
- Log how many new conversations were imported
- Store a `last_polled_intercom_at` timestamp in settings to avoid re-processing

**Migration: add `last_polled_intercom_at` to settings**
```sql
ALTER TABLE settings ADD COLUMN last_polled_intercom_at timestamptz DEFAULT NULL;
```

**File: `src/pages/FlowDiagram.tsx`**
- Add a node documenting the Intercom inbox poller as a catch-all for missed webhooks

**File: `src/pages/Index.tsx` or relevant admin page**
- Add a "Poll Intercom inbox" button (similar to existing Gmail poll trigger) so it can be run on-demand

### Technical detail

```text
Intercom Search API request:
POST https://api.intercom.io/conversations/search
{
  "query": {
    "operator": "AND",
    "value": [
      { "field": "team_assignee_id", "operator": "=", "value": "<enterprise_inbox_id>" },
      { "field": "updated_at", "operator": ">", "value": <unix_timestamp_24h_ago> }
    ]
  },
  "pagination": { "per_page": 50 }
}
```

The poller reuses the same Gmail cross-reference and manual import logic from the webhook handler, ensuring consistency.

### Files to edit
- New: `supabase/functions/poll-intercom-inbox/index.ts`
- New migration: add `last_polled_intercom_at` column to settings
- `src/pages/FlowDiagram.tsx` — add poller node
- Admin UI page — add poll trigger button

