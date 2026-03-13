

## Bug: "Add Details" modal cancel leaves conversation stuck

### Root cause
When the user clicks "Add Details" (line 550-600), the prompt message with buttons is **deleted immediately** (line 553) before the modal opens. If the user then closes/cancels the modal, no `view_submission` fires — only a `view_closed` event, which the function doesn't handle. The conversation is left in `awaiting_context` status with no way to proceed.

### Fix

**`supabase/functions/slack-interactions/index.ts`**

1. **Handle `view_closed` events** — Add a handler (after the `view_submission` block around line 468) that detects when the modal is closed/cancelled. When that happens, treat it like "Proceed without context": update status and create the Intercom ticket with the original message only.

2. **Enable `notify_on_close` on the modal** — Update the `views.open` call (line 564) to include `"notify_on_close": true` in the view definition. Without this flag, Slack does not send a `view_closed` payload when the user dismisses the modal.

### Changes summary

```
Line ~564: Add "notify_on_close": true to the modal view JSON

After line 468 (after view_submission handler): Add view_closed handler:
  - Parse private_metadata for channelId/threadTs
  - Atomically update status from awaiting_context → processing
  - If updated, call createIntercomTicket with original message
  - Return 200
```

