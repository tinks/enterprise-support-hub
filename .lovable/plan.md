

## Problem Analysis

From the screenshots, the Intercom ticket shows **"Message: Please help this user"** (Joel's mention text) instead of **"Hi Team I get errors when connecting my project to github, please help"** (the actual parent message). The Intercom AI then misidentifies the topic because it lacks the real question.

Two root causes:

1. **Parent message fetch is fragile**: The `conversations.replies` call in `slack-events` likely failed silently (possibly missing scope or API issue), so it fell back to the mention text `"@Lovable Support Bot Please help this user"` → cleaned to `"Please help this user"`.

2. **Only one message is sent to Intercom**: Even when the parent fetch works, only a single message is sent. Other Slack bots send the **full thread context** — all messages in the thread — so the AI has complete information.

## Plan

### 1. Fetch full thread context in `slack-events/index.ts`

Replace the single parent-message fetch with a full thread fetch (no `limit` parameter). Collect **all** messages in the thread (excluding bot messages), and store them all as `original_message_text`:

```
Thread context:
[User A]: Hi Team I get errors when connecting my project to github, please help
[Joel]: @Lovable Support Bot Please help this user
```

- Use `conversations.replies` without `limit` to get all messages
- Filter out bot messages (`bot_id` present or `subtype === "bot_message"`)
- Format as a readable thread transcript
- Set `slackUserId` to the **first** human message author (the original poster)

### 2. Improve the Intercom ticket body in `slack-interactions/index.ts`

No structural change needed — the `originalMessage` field will now contain the full thread context, which flows through to `createIntercomTicket` → `body: fullBody`.

### 3. Add fallback logging

If `conversations.replies` fails, log the error clearly and still include the mention text as a fallback, but prefix it to indicate it's incomplete context.

### Files to change
- **`supabase/functions/slack-events/index.ts`**: Replace lines 176-198 — fetch all thread messages, format as transcript, set `messageText` and `slackUserId`

