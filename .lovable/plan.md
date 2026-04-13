

## Fix: search doesn't find conversations by Intercom ID

### Problem
Searching "215473859684381" in the inbox finds nothing because the Gmail and manual conversation search queries don't include the `intercom_conversation_id` field. Only the Slack query searches that field.

The conversation exists in `gmail_conversations` with `intercom_conversation_id = '215473859684381'`, but the search misses it.

### Fix

**File: `src/pages/Conversations.tsx`**

Add `intercom_conversation_id.ilike.${ilike}` to the `.or()` filters for both the Gmail query (~line 769) and the manual conversations query (~line 781).

- Gmail: add `intercom_conversation_id.ilike.${ilike}` alongside the existing fields
- Manual: add `intercom_conversation_id.ilike.${ilike}` alongside the existing fields

This is a two-line change — just appending one field to each `.or()` string.

