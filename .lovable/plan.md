

## Fix Intercom poller importing non-enterprise inbox conversations

### Problem
The `poll-intercom-inbox` function is over-importing massively: **4,169 Intercom conversations were imported since 4/15/2026**, but a sample shows none are actually in the enterprise inbox (8484447). They're assigned to Sam (the AI agent) and live in other inboxes.

### Root cause
The poller searches Intercom and trusts the results without verifying inbox membership at insert time. Conversations assigned to Sam from other inboxes are slipping through and getting imported into `manual_conversations`.

### Fix

**1. Add strict inbox-membership guard in `poll-intercom-inbox/index.ts`**

After fetching the full conversation from Intercom, skip it unless `team_assignee_id` matches the configured enterprise inbox ID. Apply this to ALL search results:

```typescript
const convTeamId = String(icData.team_assignee_id || "");
if (convTeamId !== String(enterpriseInboxId)) {
  results.push({ intercomId: intercomConvId, action: "skipped_wrong_inbox" });
  continue;
}
```

This is a defensive check — even if a search query returns a conversation, we only import it if it currently belongs to the enterprise inbox.

**2. Clean up the 4,169 mis-imported conversations**

Bulk-delete approach: remove all `source='intercom'` rows in `manual_conversations` created after `2026-04-15`, plus their cascaded `manual_messages`, `conversation_audit_logs`, and `conversation_notes`. Then reset `last_polled_intercom_at` to 4/15 so the corrected poller re-imports only legitimate enterprise inbox conversations on the next run.

**3. Update Flow diagram**

Update the Intercom polling node to note: "Strict guard — only imports if `team_assignee_id == enterprise inbox ID` at fetch time."

### Files
- **Edit**: `supabase/functions/poll-intercom-inbox/index.ts` — add membership guard before insert
- **Edit**: `src/pages/FlowDiagram.tsx` — note the inbox guard
- **Migration**: bulk-delete mis-imports + reset `last_polled_intercom_at`

