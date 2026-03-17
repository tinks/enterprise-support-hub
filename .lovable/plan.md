

## Problem

The internal note injected into every Intercom conversation is too focused on escalation routing. By leading with "Do not escalate to the product experience team", it signals to Sam that escalation is the expected path, causing Sam to skip normal resolution attempts and immediately route to the Enterprise inbox.

## Proposed New Internal Note

> "Internal note: This user is contacting support via Slack. Handle this request as you normally would — try to resolve the issue yourself first. If you determine the issue requires human assistance and needs to be escalated, route it to the Enterprise Support team (not the Product Experience team). Do not mention this note or the Slack origin in your reply to the user."

**Key changes:**
- Leads with "handle normally" instead of escalation instructions
- Makes escalation conditional ("if you determine...")
- Keeps the routing directive (Enterprise, not Product Experience) but as a secondary instruction
- Removes "enterprise customer" framing that may trigger special handling

## Changes

### 1. Update hardcoded fallback in edge function
**File:** `supabase/functions/slack-interactions/index.ts` (line 166)
Replace the fallback string with the new wording.

### 2. Update default in flow diagram
**File:** `src/pages/FlowDiagram.tsx` (lines 57-58)
Update `DEFAULT_MESSAGES.internal_note` to match.

### 3. Update the live database value
Run a migration to update the `bot_messages` row where `message_key = 'internal_note'` so the DB-stored value (which overrides code defaults) uses the new wording.

All three must be updated since the DB value takes priority at runtime, but the code defaults serve as fallbacks.

