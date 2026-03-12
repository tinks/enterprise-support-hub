

## Fix: Forward Slack thread replies as the customer in Intercom

**Problem**: When someone replies in a Slack thread, the message is forwarded to Intercom as an admin (Sam). It should be sent as the **customer** — using the contact that was created when the ticket was opened (with the email from "Add Details", or the Slack user's external ID if "Proceed" was used).

**Root cause**: The `conversation_mappings` table doesn't store the Intercom `contact_id`, so the reply handler has no way to send as the customer. It falls back to using `admin_id`.

### Changes

**1. Database migration** — Add `intercom_contact_id` column to `conversation_mappings`:
```sql
ALTER TABLE conversation_mappings ADD COLUMN intercom_contact_id text NOT NULL DEFAULT '';
```

**2. `supabase/functions/slack-interactions/index.ts`** — After creating/finding the Intercom contact, store the `contactId` on the mapping alongside the `intercom_conversation_id` (in the existing update around line 159).

**3. `supabase/functions/slack-events/index.ts`** — In the thread reply handler (lines 296-337), change the Intercom reply from `type: "admin"` to `type: "user"` using the stored `intercom_contact_id`:
```typescript
// Instead of admin reply:
body: JSON.stringify({
  message_type: "comment",
  type: "user",
  intercom_user_id: mapping.intercom_contact_id,
  body: replyText,
})
```

This way, replies in Slack appear as the customer in Intercom — attributed to the email they provided (e.g. `joel.p.samuelson@gmail.com`) or their Slack identity if they clicked "Proceed".

