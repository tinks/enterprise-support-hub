

## Fix Intercom webhook inbox matching and import missing conversation

### Problem
Two issues:

1. **Conversation `215473824213503` never received a webhook event** — it doesn't appear in any logs. Likely assigned before the webhook was active, or via a bulk action that didn't fire events.

2. **Inbox matching bug** — The webhook uses `team_assignee_id || admin_assignee_id` to check if a conversation belongs to the enterprise inbox. But when a conversation is assigned to an individual admin within the enterprise inbox, `team_assignee_id` contains the admin's personal team ID (e.g., `9520895`), not the enterprise inbox ID (`8484447`). This causes legitimate enterprise conversations to be rejected. The logs confirm: `Assignment not to enterprise inbox (9520895 vs 8484447), ignoring`.

### Solution

**1. Fix inbox matching logic** (`supabase/functions/intercom-webhook/index.ts`):
- Check `team_assignee_id` first; if it doesn't match, also check if the Intercom API shows the conversation is in the enterprise inbox
- Specifically: extract both `team_assignee_id` and check it against the enterprise inbox ID. If that fails, also check `admin_assignee_id` separately and use the Intercom API to verify the conversation's inbox
- Simpler approach: check if **either** `team_assignee_id` matches OR the topic is `ticket.team.assigned` (which only fires for team assignments), and for `conversation.admin.assigned`/`conversation.admin.open.assigned`, fetch the conversation from the Intercom API to verify its team inbox

Actually, the cleanest fix: separate `team_assignee_id` from `admin_assignee_id`. Only compare `team_assignee_id` against the enterprise inbox when it exists. When only `admin_assignee_id` is present (no team), fetch the conversation details from the Intercom API to confirm which inbox it's in.

```typescript
const teamId = body.data?.item?.team_assignee_id
  ? String(body.data.item.team_assignee_id)
  : null;

let isEnterpriseInbox = teamId === enterpriseInboxId;

// If no team_assignee_id, check via Intercom API
if (!isEnterpriseInbox && !teamId && INTERCOM_API_TOKEN) {
  const convResp = await fetch(
    `https://api.intercom.io/conversations/${intercomConvId}`,
    { headers: { Authorization: `Bearer ${INTERCOM_API_TOKEN}`, Accept: "application/json" } }
  );
  if (convResp.ok) {
    const convData = await convResp.json();
    isEnterpriseInbox = String(convData.team_assignee_id || "") === enterpriseInboxId;
  }
}

if (!enterpriseInboxId || !isEnterpriseInbox) {
  // ignore
}
```

**2. Import the missing conversation now** — manually trigger the import for conversation `215473824213503` using the existing `import-intercom-ticket` edge function.

**3. Update flow diagram** (`src/pages/FlowDiagram.tsx`) — note the improved inbox matching logic.

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — fix inbox matching to handle admin-only assignments
- `src/pages/FlowDiagram.tsx` — update flow notes

### Post-deploy action
- Call `import-intercom-ticket` edge function to import conversation `215473824213503`

