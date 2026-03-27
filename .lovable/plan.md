

## Fix employee replies sent as Sam — use hardcoded admin IDs

### Problem

When a Lovable employee replies in a Slack thread, the message is forwarded to Intercom using `admin_id: adminId` — which is Sam's ID (the AI agent). This makes Sam auto-assign himself and close the ticket.

### Fix in `supabase/functions/slack-events/index.ts`

**Add a hardcoded email→admin ID map** (before the reply attribution block, ~line 614):

```typescript
const EMPLOYEE_ADMIN_IDS: Record<string, string> = {
  "joel@lovable.dev": "8430778",
  "kristina@lovable.dev": "9985999",
};
```

**Use the employee's real admin ID** in the employee branch (lines 616-624):

```typescript
if (isEmployee && adminId) {
  const employeeAdminId = senderEmail
    ? EMPLOYEE_ADMIN_IDS[senderEmail.toLowerCase()]
    : null;
  const prefixedBody = `*[From: ${senderName || senderEmail} via Slack]*\n\n${replyBody}`;
  replyPayload = {
    message_type: "comment",
    type: "admin",
    admin_id: employeeAdminId || adminId,
    body: prefixedBody,
  };
  console.log(`Attributing reply as admin (employee: ${senderEmail}, adminId: ${employeeAdminId || adminId})`);
}
```

Same change for the fallback admin branch (~line 645-654) — if `isEmployee` and email matches, use the employee's ID.

**Update flow diagram** (`src/pages/FlowDiagram.tsx`): Update the employee reply node description to note that employee replies use their real Intercom admin ID.

### Summary
- 2 files changed (`slack-events/index.ts`, `FlowDiagram.tsx`)
- Employee replies now post as the actual admin, preventing Sam from auto-closing
- Falls back to Sam's ID if employee email isn't in the map

