

## Inline attribution for human admin replies

**Goal**: When a human admin replies from Intercom, the message posts as "Ask Lovable" (bot identity) but with a clear `🧑‍💼 @Joel replied:` attribution line at the top. AI/bot replies post as plain Ask Lovable with no prefix.

### Changes

**`supabase/functions/intercom-webhook/index.ts`**:

1. Capture the Slack user ID from the existing email lookup (currently only used for avatar — store the `user_id` too)
2. When `isHumanAdmin`, prepend `*🧑‍💼 <@USLACKID> replied:*\n` to the first chunk (falls back to `*🧑‍💼 Joel replied:*` if email lookup fails)
3. Remove `username` and `icon_url` from `basePayload` — all messages post under the native bot identity
4. For non-human (AI/bot) replies, no attribution prefix — posts as plain Ask Lovable

### Result

```
Ask Lovable                              12:05 PM
🧑‍💼 @Joel replied:
Here's the answer to your question...
[👍 This resolved my issue] [👎 Escalate to human]
```

No APP badge, clean attribution, one token.

