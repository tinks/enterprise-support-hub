

## Fix: Slack replies not forwarded to Intercom after escalation

### Problem

When a user replies in a Slack thread after a ticket has been escalated, the reply is not forwarded to Intercom. Investigation of conversation `ceda1e2f` shows:

- The dedup guard correctly claims the event
- `EdgeRuntime.waitUntil(backgroundWork())` is called
- But **zero logs** appear from inside `backgroundWork()` — no "Thread reply in", no "Forwarded", no errors
- The Intercom conversation never receives the Slack reply

The `backgroundWork` closure likely fails silently because `EdgeRuntime.waitUntil` does not reliably execute the async work before the isolate shuts down.

### Fix

**File: `supabase/functions/slack-events/index.ts`**

1. Move the Intercom reply-forwarding logic out of `backgroundWork` / `EdgeRuntime.waitUntil` and into the **main request handler** (before returning the 200 response). This trades a slightly slower Slack response for reliable delivery.

2. Add an early `console.log` at the very top of the forwarding block (before any async calls) so we always have a breadcrumb if something fails.

3. Wrap the entire forwarding block in a try/catch that logs errors explicitly.

4. Keep only the non-critical work (removing feedback buttons, posting status notices) in `EdgeRuntime.waitUntil` since those are cosmetic.

**File: `src/pages/FlowDiagram.tsx`**

5. Update the flow diagram to note that reply forwarding runs inline (not in background) for reliability.

### Technical detail

```text
BEFORE:
  claim event → return 200 → EdgeRuntime.waitUntil(forward to Intercom + post notices)
  Problem: background work silently dies

AFTER:
  claim event → forward to Intercom (inline) → return 200 → EdgeRuntime.waitUntil(cosmetic: remove buttons, post notices)
  Tradeoff: Slack may retry if forwarding takes >3s, but dedup guard handles that safely
```

### Success criteria

- Joel's reply in an escalated thread appears in the Intercom conversation
- Logs show "Thread reply in..." and "Forwarded Slack reply to Intercom..." for escalated conversations
- Dedup still prevents duplicate forwarding on Slack retries

