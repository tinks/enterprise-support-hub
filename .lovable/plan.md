

## Fix: Add Ticket Conversion to Sam's Auto-Escalation

### Problem

When Sam auto-escalates, the code only reassigns the conversation to the enterprise team inbox. It does NOT convert it to a ticket (unlike the manual 👎 escalation which does both). This means the conversation stays as a conversation type in Intercom, which may cause inconsistent behavior for the support team.

### Fix

Add the ticket conversion step to both auto-escalation code paths, mirroring the manual escalation logic.

### Technical Details

**File: `supabase/functions/slack-interactions/index.ts`** — After line 608 (inside the `if (isAiEscalation)` block, after the reassignment)

Add ticket conversion:
```typescript
// Convert conversation to ticket (mirrors manual 👎 escalation)
try {
  const convertRes = await fetch(`https://api.intercom.io/conversations/${conversationId}/convert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${intercomToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
    },
    body: JSON.stringify({ ticket_type_id: "1" }),
  });
  const convertData = await convertRes.json();
  console.log(`Poll: converted conversation ${conversationId} to ticket:`, convertData.ticket_id || convertData.id);
} catch (e) {
  console.error(`Poll: failed to convert conversation ${conversationId} to ticket:`, e);
}
```

**File: `supabase/functions/intercom-webhook/index.ts`** — After line 836 (inside the `if (isAiEscalation2)` block, after the reassignment)

Add the same ticket conversion:
```typescript
// Convert conversation to ticket (mirrors manual 👎 escalation)
try {
  const convertRes = await fetch(`https://api.intercom.io/conversations/${conversationId}/convert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
    },
    body: JSON.stringify({ ticket_type_id: "1" }),
  });
  const convertData = await convertRes.json();
  console.log(`Webhook: converted conversation ${conversationId} to ticket:`, convertData.ticket_id || convertData.id);
} catch (e) {
  console.error(`Webhook: failed to convert conversation ${conversationId} to ticket:`, e);
}
```

Redeploy both edge functions after editing.

