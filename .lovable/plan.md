

## Improve bulk import review: better match display and filtering

### Problems
1. **Matched conversations show truncated/useless text** — Slack matches display `original_message_text` which is often just a single word snippet. The subject column for matches is too narrow and truncated.
2. **No filtering** — Can't filter by status (tracked/missing/possible duplicate), by file, or search by subject/user.

### Solution

**`src/pages/BulkImportReview.tsx`**

**Filtering:**
- Add a status filter row with toggle buttons: All, Tracked, Possible duplicate, Missing
- Add a text search input that filters by subject, user email, user name, or conversation ID
- Add a file filter dropdown when multiple files are uploaded

**Better match display:**
- Fetch more data for Slack conversations: also select `slack_channel_id` and `slack_thread_ts` so we have context
- Show the full subject/message text without truncation in the expanded match area — use `whitespace-normal break-words` instead of `truncate`
- Show the matched conversation's contact/email more prominently
- Add the Intercom ID from the CSV row next to the match's Intercom ID so the user can visually compare
- Show match date if available (fetch `created_at` from all three tables)

**ExistingConversation interface update:**
- Add `createdAt` field to the interface
- Fetch `created_at` from all three tables in `loadExistingConversations`

**Match card redesign:**
- Two-row layout per match: top row has source badge + full subject, bottom row has contact, Intercom ID, and date
- Remove `truncate` from subject text in match cards
- Make the match card wider and more readable

### Files to edit
- `src/pages/BulkImportReview.tsx`

