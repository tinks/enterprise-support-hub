

## Problem

When Sam's reply contains escalation keywords (e.g. "enterprise team", "transfer"), the system correctly:
1. Shows "_Sam has routed this to the Enterprise Support Team_" in Slack
2. Updates the DB status to `escalated`
3. Swaps Slack reactions (👀 → ⏳)

But it **does not reassign the Intercom conversation** to the enterprise team inbox. The actual Intercom reassignment only happens when a user manually clicks the "👎 Escalate" button. This means Sam announces the routing but the conversation stays with Sam in Intercom — nobody on the Enterprise team sees it.

For conversation `215473544900170`, Sam's reply matched escalation keywords, the Slack notice appeared, but the Intercom conversation was never reassigned. It was later resolved without human involvement.

## Fix

Add the Intercom inbox reassignment call to both auto-escalation paths (polling in `slack-interactions` and webhook relay in `intercom-webhook`), mirroring the logic already used in the manual "👎 Escalate" button handler.

### Changes

**1. `supabase/functions/slack-interactions/index.ts` — polling auto-escalation (around line 561)**

After setting status to `escalated`, add the Intercom reassignment API call:
```typescript
// After status update, reassign in Intercom
const settings = await getSettings(supabase);
if (settings.intercom_inbox_id && settings.intercom_assignee_id) {
  await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${intercomToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message_type: "assignment",
      type: "team",
      assignee_id: settings.intercom_inbox_id,
      admin_id: settings.intercom_assignee_id,
      body: "",
    }),
  });
  console.log(`Poll: reassigned conversation ${conversationId} to team inbox`);
}
```

**2. `supabase/functions/intercom-webhook/index.ts` — webhook auto-escalation (around line 774)**

Same reassignment call after status update:
```typescript
if (isAiEscalation2 && ...) {
  // existing reaction + status update ...
  // ADD: reassign in Intercom
  const settings = await getSettings(supabase);
  if (settings.intercom_inbox_id && settings.intercom_assignee_id) {
    await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message_type: "assignment",
        type: "team",
        assignee_id: settings.intercom_inbox_id,
        admin_id: settings.intercom_assignee_id,
        body: "",
      }),
    });
  }
}
```

**3. Update project knowledge** — Document that auto-escalation now includes Intercom reassignment, matching the manual escalation behavior.

