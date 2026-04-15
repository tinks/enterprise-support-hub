

## Root cause analysis

The `awaiting_context` database value serves **two completely different purposes**:

1. **Bot flow state** — Set automatically when the Ask Lovable bot posts its "Add Details / Proceed / Cancel" buttons. These conversations have a `prompt_message_ts` (the timestamp of the button message). The `context-reminder` cron is designed for THIS case only.

2. **Manual UI status** — When you select "Awaiting customer" in the status dropdown, it saves `awaiting_context` to the database. These conversations do NOT have a `prompt_message_ts` from the bot flow.

The `context-reminder` cron has NO guard to distinguish between these two cases. It just queries `WHERE status = 'awaiting_context' AND created_at < 15min ago` — so ANY conversation with that status gets picked up, including ones you manually set via the UI.

**Timeline for bfa6d5d0:**
1. At 11:44, you changed status from `active` → `awaiting_context` (via "Awaiting customer" dropdown)
2. Conversation was created yesterday, so `created_at < 15min ago` is immediately true
3. Next cron run picks it up, auto-proceeds, creates a NEW Intercom ticket, assigns to Sam
4. Sam responds, intercom-webhook forwards to Slack
5. At 12:21, you changed status again → `awaiting_context`, triggering it AGAIN

### The fix

**The cron should only target conversations from the bot's context-gathering flow** — those always have a `prompt_message_ts`. Manually-set "Awaiting customer" statuses never have one.

### Changes

**1. `supabase/functions/context-reminder/index.ts`** — Add guard for bot-flow conversations only

Change the stale query to require `prompt_message_ts IS NOT NULL`:

```typescript
const { data: staleRows, error } = await supabase
  .from("conversation_mappings")
  .select("*")
  .eq("status", "awaiting_context")
  .lt("created_at", fifteenMinAgo)
  .not("prompt_message_ts", "is", null);  // Only bot-flow conversations
```

This is the correct semantic guard: the cron should only auto-proceed conversations where the bot actually posted buttons and is waiting for a response.

Also add `.is("intercom_conversation_id", null)` as a secondary safety net — even bot-flow conversations shouldn't get a second ticket:

```typescript
  .not("prompt_message_ts", "is", null)
  .is("intercom_conversation_id", null);
```

**2. `src/pages/FlowDiagram.tsx`** — Update the context-reminder node details to document the `prompt_message_ts` guard.

**3. Update memory** — Record this distinction for future reference.

### Why previous proposals were wrong

Adding only `.is("intercom_conversation_id", null)` would prevent duplicates but would still allow the cron to process manually-set statuses on new conversations that don't have a ticket yet. The `prompt_message_ts` guard is the correct primary filter because it targets the actual intended use case.

### Files to change
- `supabase/functions/context-reminder/index.ts` — 2 lines added to query
- `src/pages/FlowDiagram.tsx` — update context-reminder node documentation

