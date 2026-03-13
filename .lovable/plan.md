

## Update reply_forwarded message text

Two files need the same string updated:

1. **`src/pages/FlowDiagram.tsx`** (line 44) — default fallback text in `DEFAULT_MESSAGES`
2. **`supabase/functions/slack-events/index.ts`** (line 473) — fallback text in the edge function

Change in both: `"Thanks for your reply! We will be back to you with an answer in a few minutes."` → `"Thanks for your reply! We will be back to you in just a few minutes."`

Additionally, if this message is stored in the `bot_messages` database table under the key `reply_forwarded`, it should be updated there too via a migration:
```sql
UPDATE bot_messages SET message_text = 'Thanks for your reply! We will be back to you in just a few minutes.' WHERE message_key = 'reply_forwarded';
```

