

## Remove Sam's responses from Slack thread

**Thread**: `C0A7HFY8J6S` / `1776199586.358589`

### Steps

1. **Fetch thread replies** using `conversations.replies` via the Slack API to identify Sam's messages (by bot_id or user matching `slack_bot_user_id` from settings)
2. **Delete each Sam message** using `chat.delete` — the bot can delete its own messages

### Implementation
- Use `exec` with `curl` to call the Slack API directly using `SLACK_BOT_TOKEN`
- First list all replies, filter for bot messages, then delete each one

### Limitation
- The bot can only delete messages it posted. If Sam's replies were posted by the bot, this will work. If they were posted by a different integration, we'd need admin/owner permissions.

