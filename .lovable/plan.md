

## Fix triple admin name in human replies

### Problem
When a human admin replies via Intercom, their name appears three times in Slack: as the bot username, in the reply header, and as a body prefix. The body prefix is redundant.

### Change in `supabase/functions/intercom-webhook/index.ts`
Remove the block (~lines 557-559) that prepends `*${adminName}:*\n` to `replyText` for human admins. The bot username and reply header already attribute the message.

### Summary
- 1 file, ~3 lines deleted
- No logic change — formatting only, no flow diagram update needed

