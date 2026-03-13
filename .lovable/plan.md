

## Fix: Use status-based gating instead of time-based dedup for notices

### Problem
The current approach tries to deduplicate "Sam is writing..." notices by scanning thread history for recent bot messages (within 120s). This is fragile — the `repliesData` variable is scoped inside a `try` block making the dedup check fail silently, and even when fixed, time-based dedup is inherently racy under rapid messages.

### Approach: Status as a state machine
Use the `conversation_mappings.status` column as a proper state machine. When a user reply comes in on an `active` thread:

1. **Before posting the notice**, transition the status from `active` → `active_pending` (a new sub-state meaning "Sam is already working on it").
2. Use an atomic update with a `WHERE status = 'active'` condition — if no rows are updated, it means another event already transitioned it, so skip posting the notice.
3. When Sam's reply arrives (via `intercom-webhook`), reset the status back to `active`.

This eliminates the need for thread-scanning dedup entirely.

### Implementation

**1. No schema change needed** — store the sub-state as a plain string value in the existing `status` text column. New value: `active_pending`.

**2. `slack-events/index.ts` — active branch (lines 484-533):**
- Replace the dedup logic with an atomic status update:
  ```typescript
  const { data: updated } = await supabase
    .from("conversation_mappings")
    .update({ status: "active_pending" })
    .eq("id", mapping.id)
    .eq("status", "active")
    .select("id");
  
  // Only post notice if WE were the one to transition
  if (updated && updated.length > 0) {
    await fetch(chat.postMessage, { text: "⏳ Sam is writing a response..." });
  }
  ```
- Keep the button-removal logic but move `repliesData` declaration outside the `try` block so it's accessible.

**3. `slack-events/index.ts` — escalated branch (lines 534-583):**
- Same pattern: transition `escalated` → `escalated_pending`, only post "reply forwarded" notice if the atomic update succeeds.

**4. `slack-events/index.ts` — thread reply handler (line 396):**
- Update the status filter to also allow `active_pending` and `escalated_pending`: change `mapping.status !== "resolved"` check to continue processing replies in pending states (already covered since it's a `!== "resolved"` check, so no change needed here).

**5. `intercom-webhook` function:**
- When Sam's reply is delivered back to Slack, reset status from `active_pending` back to `active` so the next user message can trigger a new notice.

**6. `slack-interactions/index.ts`:**
- No changes needed — feedback buttons already set status to `escalated` or `resolved`.

### Why this is better
- No thread-scanning API calls for dedup
- Race-condition-proof via atomic DB update
- Clean state machine: `active` → `active_pending` → (Sam replies) → `active`
- Fixes the current scoping bug as a side effect (dedup code is removed entirely)

