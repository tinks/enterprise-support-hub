

## Improve import error handling for `not_in_channel`

### Problem
The Slack API returns `not_in_channel` when the bot isn't a member of the target channel. The edge function passes this through as a generic "Slack API error" which isn't helpful.

### Immediate fix (manual)
Invite the bot to the channel in Slack: `/invite @Ask Lovable` in `#C07QHSS0M8F`.

### Code improvement

**`supabase/functions/import-slack-thread/index.ts`**

1. After the `conversations.replies` call, check specifically for `not_in_channel` error
2. If detected, attempt `conversations.join` (works for public channels) and retry
3. If join fails (private channel), return a clear error: "Bot is not in this channel. Invite the bot first by typing `/invite @Ask Lovable` in the channel."

### Changes
- Add auto-join logic for public channels before retrying `conversations.replies`
- Improve error message for private channels the bot can't join
- Update `src/pages/FlowDiagram.tsx` to document this behavior

### Files to edit
- `supabase/functions/import-slack-thread/index.ts` — auto-join + better error
- `src/pages/FlowDiagram.tsx` — document change

