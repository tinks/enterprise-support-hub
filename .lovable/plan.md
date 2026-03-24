

## Post Customer Message on Escalation to Mark as "Waiting"

### Problem
When a ticket is escalated (manual 👎 or Sam auto-escalation), it's reassigned and converted to a ticket, but Intercom doesn't mark it as "Waiting for response" because no customer activity occurs. Support agents sorting by "Waiting since" can't see these tickets need attention.

### Fix
After escalation (reassignment + ticket conversion), post a short message **as the customer** (contact) to the Intercom conversation. This flips the ticket state to "Waiting" in Intercom's inbox.

### Technical Details

Use the same pattern already in `slack-events` for forwarding thread replies:
```typescript
message_type: "comment",
type: "user",
intercom_user_id: mapping.intercom_contact_id,
body: "This ticket has been escalated — awaiting human support response."
```

**3 locations to add this:**

1. **`supabase/functions/slack-interactions/index.ts` — Manual 👎 escalation (after line 1196, after ticket conversion)**
   - Fetch the mapping to get `intercom_contact_id`, then POST the customer comment

2. **`supabase/functions/slack-interactions/index.ts` — Auto-escalation in polling path (after line 642, after ticket conversion)**
   - `intercom_contact_id` available from the mapping already in scope

3. **`supabase/functions/intercom-webhook/index.ts` — Auto-escalation in webhook path (after ticket conversion block)**
   - `intercom_contact_id` available from `mapping.intercom_contact_id`

Each is a single `fetch` call to `POST /conversations/{id}/reply` with the contact's ID. Wrapped in try/catch so it doesn't break the flow if it fails.

