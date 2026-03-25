# Add Direct Message Support

**Status:** Saved for later implementation
**Date:** 2026-03-25
**Note:** Only works for users in the same workspace as the bot. External (Slack Connect) users cannot DM the bot.

## Overview
Enable users to DM the bot directly in Slack to ask questions privately. When a user sends a DM, the bot treats it the same as an @mention — posting the context prompt and flowing through the existing ticket creation pipeline.

## Requirements
- **Slack App Config**: The custom Slack app needs the `im:history` scope and must subscribe to `message.im` bot events. Update the app manifest at https://api.slack.com/apps.

## Code Change

**File: `supabase/functions/slack-events/index.ts`**

Add a new handler block after the `app_mention` block (after line 384) for DM messages:

```
if (event.type === "message" && event.channel_type === "im" && !event.thread_ts && !event.bot_id && event.user && event.user !== expectedBotId)
```

This catches top-level DM messages (not thread replies, not from bots). The handler will:

1. Use the DM channel ID + message ts as the thread identifier (same as @mention uses `event.ts` when there's no `thread_ts`)
2. Atomically claim via upsert into `conversation_mappings` (same pattern as app_mention)
3. Post the same context prompt with "Add Details" / "Proceed" buttons
4. Save `prompt_message_ts`

The existing thread reply handler (line 388) already works for threaded replies regardless of channel type, so follow-up messages in the DM thread will flow through normally.

## What Stays the Same
- The entire downstream flow (context modal, ticket creation, Intercom relay, escalation, reminders) works unchanged — it's all keyed on `slack_channel_id` + `slack_thread_ts`
- Thread replies in the DM will be handled by the existing message handler at line 388

## Manual Step Required
Add the `im:history` scope and subscribe to `message.im` events in your Slack app settings.

## Limitations
- Only works for users in the workspace where the bot is installed
- External users (Slack Connect) cannot DM the bot — they must use @mentions in shared channels
