

# Auto-Reply with Context Form + Bot Identity

## Slack Connector Identity

Yes -- the Slack connector sends messages as **"Lovable App"** (the bot name of the centrally managed Lovable Slack app). You can customize the display name and icon per message using the `username` and `icon_emoji`/`icon_url` parameters in `chat.postMessage`. So we can make it appear as "Lovable Support Bot" or any name you choose.

## Plan

### 1. Send an instant auto-reply when a mention is detected (`poll-slack`)

Right after detecting a new mention and **before** creating the Intercom conversation, post an ephemeral-style threaded reply asking the user for context. This uses `chat.postMessage` (not ephemeral, since ephemeral messages can't be replied to in threads reliably).

The message will include Block Kit fields:

```
👋 Thanks for reaching out! To help us assist you faster, please reply with:

• *Lovable account email* (optional)
• *Project link or ID* (optional)
• *Detailed description of your issue*
```

We send this with `username: "Lovable Support Bot"` and a custom icon.

### 2. Wait for user reply before creating Intercom ticket

Currently the Intercom conversation is created immediately with just the mention text. Instead:

- On first detection: send the auto-reply, store the mapping with status `"awaiting_context"` (no Intercom conversation yet)
- On subsequent polls: check for thread replies from the original user in threads marked `awaiting_context`. When a reply is found, combine the original message + reply context and **then** create the Intercom conversation with the richer context
- Fallback: if no reply after a configurable time (or next poll cycle), create the Intercom conversation with just the original text anyway so nothing gets lost

### 3. Enrich Intercom contact with provided email

If the user includes their Lovable account email in the reply, use it to search/create the Intercom contact by email instead of the generic Slack user ID. This solves the original problem without needing `users:read` scope.

### Changes

**Edit `supabase/functions/poll-slack/index.ts`:**
- After detecting a new mention, post a threaded auto-reply via `chat.postMessage` with `username: "Lovable Support Bot"` and context-gathering prompt
- Store the mapping immediately with status `awaiting_context` (no `intercom_conversation_id` yet)
- Add a second pass: for all `awaiting_context` mappings, fetch thread replies via `conversations.replies`, parse any context provided, then create the Intercom conversation with enriched data
- If the reply contains an email, use it for the Intercom contact lookup/creation

**Database migration:**
- Add `status` column default to `awaiting_context` (currently no default)
- Make `intercom_conversation_id` nullable (since we won't have it immediately)
- Add `original_message_text` column to store the initial mention text
- Add `slack_user_id` column to track who sent the mention

### Bot display name

All `chat.postMessage` calls (here and in `intercom-webhook` and `slack-interactions`) will include:
```json
{
  "username": "Lovable Support Bot",
  "icon_emoji": ":heart:"
}
```

This overrides the default "Lovable App" name for these messages specifically.

