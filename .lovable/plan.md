

## Allow Multi-Turn AI Conversation Before Escalation

### Problem
Currently, when a user replies to Sam's answer in Slack (without clicking a button), the system immediately escalates to the human team — removing feedback buttons, reassigning the Intercom conversation, and posting an escalation notice. Users can't have a back-and-forth with Sam.

### Current flow (thread reply while status = "active")
1. Forward reply to Intercom ✓
2. Remove all feedback buttons from thread ✗ (premature)
3. Escalate: reassign to team inbox, swap 👀→⏳, post "reply forwarded" notice ✗ (premature)

### New flow (thread reply while status = "active")
1. Forward reply to Intercom ✓
2. **Do nothing else** — Sam will reply via `intercom-webhook`, which already posts the response with new 👍/👎 buttons
3. Escalation only happens when user clicks 👎

For **escalated** threads (status = "escalated"), keep current behavior: forward reply, remove old buttons, post "reply forwarded" notice.

### Changes

**`supabase/functions/slack-events/index.ts`** (lines 405–476)

Wrap the button-removal block (lines 405–432) and the escalation block (lines 434–476) inside a condition: only execute when `mapping.status === "escalated"`. When status is `"active"`, the function just forwards the reply to Intercom and returns — Sam handles the rest.

```
// Before (line 405):
// Remove feedback buttons from thread messages
try { ... }

// After:
if (mapping.status === "escalated") {
  // Remove feedback buttons (existing code lines 405-432)
  // Post "reply forwarded" notice (existing code lines 467-475)
  // NO re-escalation needed (already escalated)
}
// If status is "active", do nothing — Sam will reply via intercom-webhook
```

**`src/pages/FlowDiagram.tsx`** — Update the flow diagram:

- **Node 5** (AI responds): Update details/desc to mention users can reply to continue chatting with Sam
- **Add a new loop edge** from node 5 back to itself (or a note) indicating "User replies → Sam responds again"
- **Node 6b-i**: Update description to clarify this only happens after explicit 👎 escalation, not on any reply

