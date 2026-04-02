

## Fix thread reply forwarding to Intercom after escalation

### Problems found

1. **Smart routing uses wrong ID**: After escalation, conversations are converted to tickets and `intercom_ticket_id` is stored. The forwarding code in `slack-events` then tries to reply via `/conversations/{ticket_id}/reply`, but ticket IDs are not valid conversation IDs. The retry logic also sends to the same wrong endpoint.

2. **No diagnostic visibility**: When forwarding fails, there's no way to see what happened since logs rotate quickly and the error handling is minimal.

3. **Some channels don't deliver events**: Channel `C0AGQ4YKTPX` sends zero `message` events to the webhook — this is a Slack app configuration issue (likely needs `message.channels` / `message.groups` event subscriptions verified) and cannot be fixed in code.

### Changes

**`supabase/functions/slack-events/index.ts`**

1. Fix smart routing: always use `intercom_conversation_id` for the `/conversations/{id}/reply` endpoint, never `intercom_ticket_id`. The original conversation ID remains valid after ticket conversion (proven by the escalation code in `slack-interactions` which successfully replies using it).

2. Add enhanced logging around the forwarding path:
   - Log when the dedup claim succeeds/fails with the event timestamp
   - Log the target ID being used for Intercom reply
   - Log success/failure of the Intercom API response

3. Keep the retry-as-admin logic (for cases where `type: "user"` is rejected on tickets) but use the correct conversation ID.

**`src/pages/FlowDiagram.tsx`** — Document the routing fix.

### What this won't fix

- Channel `C0AGQ4YKTPX` not receiving events — this requires checking the Slack app's event subscription settings to ensure `message.channels` and `message.groups` are both enabled. This is a Slack app admin action, not a code change.

### Technical detail

```text
Before (broken):
  targetId = mapping.intercom_ticket_id || mapping.intercom_conversation_id
  POST /conversations/{ticket_id}/reply  →  fails (invalid ID)
  retry /conversations/{ticket_id}/reply →  fails again

After (fixed):
  targetId = mapping.intercom_conversation_id  (always)
  POST /conversations/{conversation_id}/reply  →  succeeds
  retry as admin if needed                     →  same correct ID
```

### Files to edit
- `supabase/functions/slack-events/index.ts` — fix routing + add logging
- `src/pages/FlowDiagram.tsx` — document change

