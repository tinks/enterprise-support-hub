

## Auto-update conversation status on replies

### What it does
Automatically transitions conversation status based on who replies:
- **Customer replies** → status changes to `awaiting_support`
- **Admin replies (Joel, Kristina, Sam)** → status changes to `awaiting_customer`

This applies across all three conversation sources: Slack, Gmail (via Intercom), and manual/Intercom conversations.

### Where the changes go

**1. `supabase/functions/intercom-webhook/index.ts`** — Intercom reply handling

Currently at ~line 1241, after posting to Slack, the webhook updates status based on escalation logic. Add status transitions:

- When `isHumanAdmin` is true (Joel/Kristina reply) or the reply is from Sam (AI): set status to `awaiting_customer` on the `conversation_mappings` row
- For manual conversations (the fallback path at ~line 461): when inserting a new reply, also update `manual_conversations.status` based on the reply's `role` — admin replies → `awaiting_customer`, user replies → `awaiting_support`
- For close events on `manual_conversations` and `gmail_conversations`: keep existing resolved logic (no change needed)

**2. `supabase/functions/slack-events/index.ts`** — Slack thread replies

Currently at ~line 561, when a user replies in a Slack thread, the code forwards to Intercom. After the forward succeeds:
- If the replying user is the original requester (customer): update `conversation_mappings.status` to `awaiting_support`
- If the replying user is an employee (Joel/Kristina): update status to `awaiting_customer`

This replaces the current `active_pending` / `escalated_pending` intermediate states for the purpose of status tracking while preserving the "Sam is writing..." notice logic.

**3. `src/pages/FlowDiagram.tsx`** — Update flow diagram notes

Document the new automatic status transition rules.

### Technical details

- Status updates use atomic guards (`eq("id", mapping.id)`) to prevent race conditions
- The `active_pending` and `escalated_pending` intermediate states remain for their existing purpose (dedup of "Sam is writing" notices) — the awaiting_support/awaiting_customer status is set as the final status after the reply is processed
- For Intercom webhook replies: the author type check (`isHumanAdmin` flag, already computed) determines if it's admin or customer
- For Slack thread replies: `isEmployee` and `isOriginalRequester` flags (already computed) determine the role
- Gmail conversations get status updates via the Intercom webhook path (replies flow through Intercom)
- No new statuses need to be added — `awaiting_support` and `awaiting_customer` already exist in the schema

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — add status transitions on reply processing
- `supabase/functions/slack-events/index.ts` — add status transitions on thread reply forwarding
- `src/pages/FlowDiagram.tsx` — document new status transition rules

