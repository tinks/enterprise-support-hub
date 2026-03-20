

## Fix: First Human Reply Lost After Escalation

### Problem

After escalation (both manual 👎 and Sam auto-escalation), the first human agent reply from Intercom is not relayed to Slack. The second reply works. All escalated conversations show zero webhook processing logs, confirming this is systemic.

### Root Cause (Most Likely)

For `ticket.admin.replied` webhooks, the payload has `item.type = "ticket_ticket_part"`. In this structure, `item.id` may be the **ticket part ID** (not the conversation/ticket ID), while the actual ticket ID is at `item.ticket.id`. Our ID extraction prioritizes `item.id` first, so it grabs the part ID, looks up the mapping by part ID, finds nothing, and silently skips the reply.

The second reply may work because Intercom also fires a `conversation.admin.replied` event (with the original conversation ID in `item.id`), which arrives slightly later.

### Fix

**File: `supabase/functions/intercom-webhook/index.ts`**

**1. Fix ID extraction priority for ticket events (line 159)**

For ticket-type topics, prefer `item.ticket.id` over `item.id`:

```typescript
const conversationId = (topic.startsWith("ticket.")
  ? (body.data?.item?.ticket?.id || body.data?.item?.id)
  : (body.data?.item?.id || body.data?.item?.ticket?.id))
  || body.data?.item?.ticket_id
  || body.data?.item?.conversation_id;
```

**2. Add fallback lookup when no mapping found (after line 174)**

If initial lookup fails, try alternative IDs from the payload:

```typescript
if (!mapping) {
  // Try alternative IDs from payload before giving up
  const altIds = [
    body.data?.item?.ticket?.id,
    body.data?.item?.id,
    body.data?.item?.ticket_id,
    body.data?.item?.conversation_id,
  ].filter(Boolean).map(String).filter(id => id !== String(conversationId));

  for (const altId of altIds) {
    const { data: altMapping } = await supabase
      .from("conversation_mappings")
      .select("*")
      .eq("intercom_conversation_id", altId)
      .maybeSingle();
    if (altMapping) {
      mapping = altMapping;
      console.log(`Found mapping via alt ID ${altId} (original: ${conversationId})`);
      break;
    }
  }
}
```

**3. Add diagnostic logging (enhance line 174)**

Log all available IDs when no mapping is found so we can diagnose future issues:

```typescript
if (!mapping) {
  console.log(`No mapping found for conversation ${conversationId}. Payload IDs: item.id=${body.data?.item?.id}, ticket.id=${body.data?.item?.ticket?.id}, ticket_id=${body.data?.item?.ticket_id}, type=${body.data?.item?.type}`);
}
```

**4. Also fix the API parts fetch (line 278)**

After ticket conversion, `GET /conversations/{id}` might not return parts. Add fallback to tickets endpoint:

```typescript
if (!convoRes.ok || !apiParts?.length) {
  // Try tickets endpoint for converted tickets
  const ticketRes = await fetch(`https://api.intercom.io/tickets/${conversationId}`, { ... });
  if (ticketRes.ok) {
    const ticketData = await ticketRes.json();
    // Extract parts from ticket response
  }
}
```

Redeploy `intercom-webhook` after editing.

### Why This Fixes It

- Prioritizing `item.ticket.id` for ticket events ensures we get the conversation/ticket ID, not a part ID
- Fallback lookup catches cases where the ID structure differs from what we expect
- Diagnostic logging will help identify the exact payload structure if it happens again
- Tickets endpoint fallback ensures conversation parts are fetched even after conversion

