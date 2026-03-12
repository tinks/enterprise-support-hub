

## Add status emoji reactions to the original Slack message

Use Slack's `reactions.add` API to add emoji reactions to the original thread message at each status transition.

| Status | Emoji | Trigger location |
|--------|-------|-----------------|
| Processing (Sam working) | 👀 `eyes` | `slack-interactions/index.ts` — inside `createIntercomTicket()` after the acknowledgment message (line ~74) |
| Escalated | ⏳ `hourglass_flowing_sand` | `slack-events/index.ts` — when status updates to "escalated" (line ~419), AND `slack-interactions/index.ts` — feedback_negative handler (line ~545) |
| Resolved | ✅ `white_check_mark` | `slack-interactions/index.ts` — feedback_positive handler (line ~525), AND `intercom-webhook/index.ts` — closed topic handler (line ~191) |

### Implementation

**Helper pattern** (added to each file that needs it):
```typescript
async function addReaction(token: string, channel: string, timestamp: string, emoji: string) {
  await fetch(`${SLACK_API_URL}/reactions.add`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, timestamp, name: emoji }),
  });
}
```

**File changes:**

1. **`supabase/functions/slack-interactions/index.ts`** — Add `addReaction` helper, then:
   - In `createIntercomTicket` (~line 74): call `addReaction(slackBotToken, channelId, threadTs, "eyes")`
   - In `feedback_positive` (~line 525): call `addReaction(SLACK_BOT_TOKEN, channel, threadTs, "white_check_mark")`
   - In `feedback_negative` (~line 545): call `addReaction(SLACK_BOT_TOKEN, channel, threadTs, "hourglass_flowing_sand")`

2. **`supabase/functions/slack-events/index.ts`** — Add `addReaction` helper, then:
   - In escalation block (~line 419): call `addReaction(SLACK_BOT_TOKEN, channelId, threadTs, "hourglass_flowing_sand")`

3. **`supabase/functions/intercom-webhook/index.ts`** — Add `addReaction` helper, then:
   - In closed/resolved handler (~line 191): call `addReaction` with `"white_check_mark"` using the mapping's `slack_channel_id` and `slack_thread_ts`

The `threadTs` is the parent message timestamp, so the emoji will appear on the original question message.

