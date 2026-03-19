

## Problem: Race Condition on Resolved Conversations

When a user clicks "👍 This resolved my issue," the feedback handler sets the status to `resolved` and closes the Intercom conversation. However, Intercom may fire a `conversation.admin.replied` webhook (e.g., Kristina's reply) at nearly the same time. The webhook handler has a special exception (line 260-268) that allows processing replies on `resolved` conversations if `last_intercom_part_id` is null (meaning no reply was ever posted to Slack). This exception was designed for edge cases where Sam never replied before closure, but it inadvertently allows **new replies with feedback buttons** to appear after the conversation was already resolved — exactly what the screenshot shows.

### Root Causes

1. **Resolved conversations still get feedback buttons**: The webhook posts feedback buttons (lines 698-722) without checking if the conversation is already `resolved`. So even when the "resolved + null marker" exception fires, the reply appears with actionable buttons.

2. **PostgREST schema cache issue** (secondary): Logs show `"column conversation_mappings.last_intercom_part_id does not exist"` errors, even though the column exists. This is a schema cache staleness problem. The fallback logic handles it, but it means dedup is less reliable.

### Fix

**1. `supabase/functions/intercom-webhook/index.ts` — Skip feedback buttons for resolved conversations**

At line 683 where `isLastChunk` feedback logic begins, add a check: if the mapping status is `resolved`, never add feedback buttons. Only post the reply text (informational only).

```typescript
// Before the existing isLastChunk block (line 683), add:
const isAlreadyResolved = mapping.status === "resolved";

// Then modify the feedback button section:
if (isLastChunk) {
  if (isAlreadyResolved || isInterimMessage) {
    // Already resolved or interim — no buttons
  } else if (isAiEscalation) {
    // ... existing escalation logic
  } else {
    // ... existing feedback button logic
  }
}
```

This ensures that even if the "no reply was ever posted" exception allows a final reply through, it won't re-add interactive buttons on an already-closed conversation.

**2. Reload PostgREST schema cache** — Run a migration (even a no-op comment) to force the schema cache to refresh, fixing the `last_intercom_part_id does not exist` error.

**3. Update project knowledge** — Document the resolved-status button guard.

