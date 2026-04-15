

## Add editable date picker to conversation detail timeline

### Problem
The Timeline card in the sidebar (lines 1229-1242) displays dates as read-only text. You want to be able to change the `created_at` date for a conversation.

### Solution
Make the "Created" date in the Timeline card clickable, opening a date+time picker popover. On selection, update the `created_at` field in the appropriate table (`conversation_mappings`, `gmail_conversations`, or `manual_conversations`) and log an audit entry.

### Changes

**1. Edit: `src/pages/ConversationDetail.tsx`**

- Add imports for `Calendar`, `Popover`/`PopoverContent`/`PopoverTrigger`, `format` from date-fns, and `CalendarIcon`
- Update `renderDates()` to return a richer structure indicating which dates are editable (only `created_at`)
- Replace the "Created" date row with a Popover containing a Calendar picker and a time input
- On date selection: update the correct table's `created_at`, refresh local state, log an audit entry with old/new values, and show a toast

### Technical detail

- The table to update is determined by the `source` query param: `conversation_mappings` (slack), `gmail_conversations` (gmail), `manual_conversations` (manual)
- Time input uses a standard `<Input type="time">` alongside the Calendar for full datetime editing
- Audit log entry: action `"updated_created_at"`, old value → new value

