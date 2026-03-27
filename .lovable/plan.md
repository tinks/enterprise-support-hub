

## Add bot-ignore filters to knowledge file

### What's being added

A new bullet point under **§6 Step 1: User @mentions bot** documenting the two guards added to `slack-events`:

1. **Bot filter** — Events with `event.bot_id` or `subtype === "bot_message"` are silently ignored (prevents other Slack bots from triggering Ask Lovable)
2. **No-user filter** — Events without `event.user` are silently ignored (prevents integrations without a real Slack user from triggering Ask Lovable)

### How

- Read current `content` from `knowledge_documents` table
- Insert the new bullets after line 113 (the existing "Atomic INSERT" bullet) in the knowledge text
- Write the updated text to `pending_content` + `pending_summary` via database update
- User reviews and approves in the Knowledge tab

### Location in document

**§6, Step 1** (after "Atomic INSERT with ON CONFLICT DO NOTHING prevents race from Slack retries"):

```
- **Bot filter:** Events with `event.bot_id` or `subtype === "bot_message"` are silently ignored — other Slack bots cannot trigger Ask Lovable
- **No-user filter:** Events without `event.user` are silently ignored — integrations without a real Slack user ID are skipped
```

### Summary
- No code file changes
- 1 database update (pending knowledge content)
- User approval required via Knowledge tab

