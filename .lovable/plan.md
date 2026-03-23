

## Auto-Lookup Slack User Email

### Problem
When a user clicks "Proceed" (skipping the modal), the Intercom contact is created as "Slack User U091..." with no email. Even when the Slack workspace has the user's email available via `users.info` API.

### Fix

**File: `supabase/functions/slack-interactions/index.ts`**

At the start of `createIntercomTicket()` (after line 142, before the ack message), if no email was provided, look up the Slack user's email:

```typescript
// Auto-lookup Slack user email if not provided
let resolvedEmail = email;
if (!resolvedEmail) {
  try {
    const userRes = await fetch(`${SLACK_API_URL}/users.info?user=${slackUserId}`, {
      headers: { Authorization: `Bearer ${slackBotToken}` },
    });
    const userData = await userRes.json();
    if (userData.ok && userData.user?.profile?.email) {
      resolvedEmail = userData.user.profile.email;
      console.log(`Auto-resolved email for ${slackUserId}: ${resolvedEmail}`);
    }
  } catch (e) {
    console.error("Failed to lookup Slack user email:", e);
  }
}
```

Then use `resolvedEmail` instead of `email` throughout the rest of the function (contact search, create, body parts). The bot already has `users:read.email` scope so this will work.

This means even "Proceed" (no modal) tickets will have the user's real email and name in Intercom.

