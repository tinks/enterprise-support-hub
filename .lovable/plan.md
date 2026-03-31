

## Close Intercom conversation as the actual assignee, not Sam

### Problem
When a user clicks 👍 in Slack, the `slack-interactions` function closes the Intercom conversation using `intercom_assignee_id` (Sam's admin ID). This means Sam gets credit for resolving the ticket instead of the human agent who actually handled it.

### Fix
Before closing the conversation, fetch the current conversation from Intercom to get the actual assignee. Use that admin's ID to close the conversation. Fall back to Sam's ID only if no assignee is found.

### Changes

**`supabase/functions/slack-interactions/index.ts`** — lines 1370-1386

Replace the hardcoded `adminId` with a dynamic lookup:

```ts
// Fetch current conversation to find the actual assignee
let adminId = cachedSettings.intercom_assignee_id || "8430778"; // fallback to Sam
try {
  const convoRes = await fetch(`https://api.intercom.io/conversations/${conversationId}`, {
    headers: {
      Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
      Accept: "application/json",
      "Intercom-Version": "2.11",
    },
  });
  if (convoRes.ok) {
    const convoData = await convoRes.json();
    if (convoData.admin_assignee_id) {
      adminId = String(convoData.admin_assignee_id);
    }
  }
} catch (e) {
  console.error("Failed to fetch conversation assignee, falling back to default:", e);
}
```

This single API call before the close ensures the actual support agent gets credit. If the conversation is still assigned to Sam (no escalation happened), Sam closes it — same as before.

**`src/pages/FlowDiagram.tsx`** — document that thumbs-up resolution now closes as the current assignee.

### Files to edit
- `supabase/functions/slack-interactions/index.ts` — dynamic assignee lookup before close
- `src/pages/FlowDiagram.tsx` — update flow documentation

