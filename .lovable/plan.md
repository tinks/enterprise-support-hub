

## Send Group DM Notification on Ticket Creation

### What changes
**`supabase/functions/slack-interactions/index.ts`** — At the end of `createIntercomTicket()` (after line 277), add a helper that:

1. Calls `conversations.open` with the hardcoded user IDs (`U0AFU714807` for Kristina, `U091GANMA2U` for Joel) to open/get a group DM
2. Posts a message to that DM channel with:
   - Who created the issue (`<@slackUserId>`)
   - Link to the Slack thread (constructed from `channelId` + `threadTs`)
   - Link to the Intercom conversation

No database changes needed — the two recipient IDs are hardcoded directly in the function since you already provided them.

### Notification message format
```
🎫 New ticket created by <@U123CREATOR>
• Slack thread: https://app.slack.com/archives/C0123/p1234567890
• Intercom: https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/12345?view=List
```

### Technical details
- Slack thread permalink: replace the `.` in `threadTs` with empty string to form the `p` parameter
- `conversations.open` with `users: "U0AFU714807,U091GANMA2U"` returns a multi-party DM channel ID
- Single `chat.postMessage` call to that channel
- Wrapped in try/catch so notification failure doesn't break ticket creation

