

## Fix: Allow Intercom follow-ups to reopen resolved Slack conversations

### Problem
When Sam's automated follow-up workflow runs on a resolved conversation (snooze → reply → close), the webhook guard at line 752 blocks everything because `status === "resolved"` and `last_intercom_part_id` is set. The screenshot shows three untracked follow-up messages from Sam sent over 6 days, none of which updated the conversation status.

This affects ALL resolved Slack conversations that receive Intercom follow-ups — status never transitions back from "resolved."

### Root cause
The resolved guard (lines 752-756) was designed to prevent duplicate close notifications, but it's too aggressive. It blocks legitimate follow-up replies that should reopen the conversation and track ongoing activity.

### Solution
Modify the resolved guard to allow admin replies through when the conversation was resolved but is being actively followed up on. Specifically:

1. **Allow admin replies on resolved conversations** — when `status === "resolved"` and the incoming event is an admin reply (`conversation.admin.replied` or `conversation.admin.single.reply`), let it through and update the status to `awaiting_customer` (since Sam is following up waiting for the customer)
2. **Keep blocking user replies on resolved conversations** — the existing behavior for user replies after resolution is fine (they should start new threads)
3. **Allow close events on already-resolved conversations** — the close handler already handles this correctly (line 674 checks `status !== "resolved"`)

### Changes

**File: `supabase/functions/intercom-webhook/index.ts`** (~lines 750-760)
- Modify the resolved guard: instead of blocking all replies when resolved + has part ID, only block **user** replies. Allow **admin** replies through.
- When an admin reply passes through on a resolved conversation, update status to `awaiting_customer` to reflect the follow-up state. This happens after the reply is posted to Slack.

**File: `src/pages/FlowDiagram.tsx`**
- Update the webhook handler node to document that admin follow-ups can reopen resolved conversations.

### Technical detail
```text
Current guard (line 752):
  if status=resolved AND last_intercom_part_id!=null → BLOCK ALL

New guard:
  if status=resolved AND last_intercom_part_id!=null:
    if topic is admin reply → ALLOW (let it through, update status after posting)
    if topic is user reply → BLOCK (unchanged)
```

After the reply is posted to Slack, the status update logic (which already exists further down in the file) will set the status to `awaiting_customer` for admin replies, effectively reopening the conversation for follow-up tracking.

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — relax resolved guard for admin replies
- `src/pages/FlowDiagram.tsx` — update documentation

