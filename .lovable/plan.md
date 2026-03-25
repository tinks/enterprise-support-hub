

## Auto-Mark Lovable Employees as Test + Route to Slack Test Inbox

### What changes

**1. Database migration — Add test inbox ID to settings**

Add `test_intercom_inbox_id` column to `settings` with default value `'10219738'` (the "Slack Test" inbox).

**2. `supabase/functions/slack-events/index.ts` — Auto-detect Lovable employees**

After claiming the conversation (upsert), look up the Slack user's email via `users.info`. If the email ends with `@lovable.dev`, update the mapping's `is_test = true` regardless of the `testing_mode` toggle:

```typescript
// After upsert claim succeeds
const userRes = await fetch(`${SLACK_API_URL}/users.info?user=${slackUserId}`, {
  headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
});
const userData = await userRes.json();
const userEmail = userData.user?.profile?.email || "";
const isLovableEmployee = userEmail.endsWith("@lovable.dev");

if (isLovableEmployee && !settings.testing_mode) {
  await supabase.from("conversation_mappings")
    .update({ is_test: true })
    .eq("id", claimedId);
}
```

This applies to both the `app_mention` and DM handler blocks.

**3. `supabase/functions/slack-interactions/index.ts` — Route test conversations to Slack Test inbox**

In `createIntercomTicket`, after resolving the email, check if the conversation is marked `is_test`. If so, use `settings.test_intercom_inbox_id` instead of `settings.intercom_inbox_id` for assignment:

```typescript
const inboxId = mapping.is_test 
  ? (settings.test_intercom_inbox_id || settings.intercom_inbox_id)
  : settings.intercom_inbox_id;
```

Same logic in the escalation reassignment block.

**4. `supabase/functions/context-reminder/index.ts` — Same inbox routing for auto-proceed**

Apply the same inbox routing pattern when the auto-proceed flow assigns conversations.

**5. `supabase/functions/intercom-webhook/index.ts` — Same inbox routing for escalation**

Apply the same pattern when escalation reassignment happens.

**6. UI — Add test inbox field to Settings page (`src/pages/Index.tsx`)**

Add a "Test Intercom Inbox ID" input field (pre-filled with `10219738`), visible below the existing Intercom fields. Save alongside other settings.

**7. Intercom conversation attributes — Tag as test**

When `is_test` is true, set `support_tier: "Test"` instead of `"Enterprise Support"` on the Intercom conversation, so test conversations are easily filterable in Intercom reporting.

### Summary
- 1 migration (1 new column on `settings`)
- 4 edge functions updated (employee detection + inbox routing)
- 1 UI file updated (new settings field)
- Lovable employees auto-detected via `@lovable.dev` email domain

