

## Add Separate Auto-Proceed Ack Message

### Changes

**1. Database — Insert new `auto_proceed_ack` row into `bot_messages`**

> "We've gone ahead and connected you with Sam, Lovable's AI Support Agent. Sam may take 3–4 minutes to respond. Hang tight!"

**2. Code — `supabase/functions/context-reminder/index.ts` (line ~243)**

Change from `botMsgs["ticket_created_ack"]` to `botMsgs["auto_proceed_ack"]`, with the new fallback string.

No changes to `ticket_created_ack` or `slack-interactions` — those stay as-is.

