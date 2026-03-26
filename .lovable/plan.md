

## Attribute Slack Replies to Actual Sender in Intercom

### Problem

When someone replies in a Slack thread, the message is forwarded to Intercom as the **original contact** (the customer who opened the ticket). This means if you or another team member replies in Slack, it shows up in Intercom as if the customer said it — there's no way to tell who actually wrote it.

### Current behavior (lines 594-651 of `slack-events`)

1. If `intercom_contact_id` exists → reply as the customer (`type: "user"`)
2. Fallback → reply as the configured admin (`type: "admin"`)

### Proposed behavior

When a Slack thread reply is detected:

1. **Look up the Slack user's email** via `users.info` API (already done elsewhere in the function)
2. **If the sender is a Lovable employee** (`@lovable.dev` email) → send as an **admin reply** (`type: "admin"`) with a prefix like `*[From: Alice Smith via Slack]*` so it's clear in Intercom who wrote it
3. **If the sender is the original requester** (same `slack_user_id` as `mapping.slack_user_id`) → keep current behavior, reply as the customer contact
4. **If it's someone else** (non-employee, not the original requester) → reply as customer but prefix with `*[From: {name} via Slack]*`

### Changes

**1. `supabase/functions/slack-events/index.ts`** — Thread reply handler (~line 566-728)

- After entering `backgroundWork`, resolve the replying user's display name and email via Slack `users.info`
- Branch the Intercom reply logic:
  - **Employee sender** → use `type: "admin"`, `admin_id` from settings, prefix body with sender name
  - **Original requester** → keep `type: "user"`, `intercom_user_id: mapping.intercom_contact_id` (current behavior)
  - **Other** → use `type: "user"` but prefix body with sender name
- This ensures Intercom shows admin-attributed replies when team members respond from Slack

### What this gives you

- When you reply in Slack, the Intercom ticket shows it as an admin response with your name
- When the original customer replies in Slack, it still shows as their message
- Clear audit trail of who said what across both platforms

