

## Fix: Add Escalate Button to Incident.io Status Block

### Problem

When an incident.io-related reply is posted to Slack, the status block only shows "👍 This resolved my issue" and "📡 Subscribe to status updates" — the "👎 Escalate to human" button is missing. The main reply code skips buttons entirely for incident replies (line 720), expecting them to be in the status block, but the status block never included the escalate button.

### Fix

**File: `supabase/functions/intercom-webhook/index.ts`** — Lines 501-517

Add the "👎 Escalate to human" button to the `incidentStatusBlock` actions, conditioned on the conversation not already being escalated (same guard used elsewhere):

```typescript
{
  type: "actions",
  elements: [
    {
      type: "button",
      text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
      action_id: "feedback_positive",
      value: String(conversationId),
    },
    // Add escalate button if not already escalated
    ...(mapping.status !== "escalated" && mapping.status !== "escalated_pending" ? [{
      type: "button",
      text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
      action_id: "feedback_negative",
      value: String(conversationId),
    }] : []),
    {
      type: "button",
      text: { type: "plain_text", text: "📡 Subscribe to status updates", emoji: true },
      url: STATUS_PAGE_URL,
      action_id: "incident_io_subscribe",
    },
  ],
},
```

Redeploy `intercom-webhook` after editing.

