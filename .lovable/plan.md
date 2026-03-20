

## Fix: Intercom contact not updated with email on conflict

### Root Cause

When a user provides an email via "Add details", the code searches Intercom contacts by email (line 210). If no contact with that email exists, it tries to create one with `external_id: slackUserId` + email. But if this Slack user previously created a ticket **without** an email, a contact already exists with that `external_id` and name `"Slack User U091..."`. The create call returns a 409 conflict, and the code extracts the existing contact ID — but never updates the contact's email or name. So the ticket is filed under "Slack User" despite the email being provided.

### Fix

**File: `supabase/functions/slack-interactions/index.ts`**

After resolving a conflict (line 252-254), if an email was provided, update the existing contact with the email and name via `PUT /contacts/{id}`:

```typescript
if (conflictId) {
  console.log(`Contact conflict resolved — using existing id=${conflictId}`);
  contactId = conflictId;
  // Update contact with email if provided
  if (email) {
    await fetch(`https://api.intercom.io/contacts/${conflictId}`, {
      method: "PUT",
      headers: intercomHeaders,
      body: JSON.stringify({ email, name: email }),
    });
  }
}
```

Also update the contact when found via search (line 222-223) — if the search was by `external_id` (no email) but now email is provided, or if search was by email but name is stale:

```typescript
if (contactData.data?.length > 0) {
  contactId = contactData.data[0].id;
  // Update contact with email/name if provided and different
  if (email) {
    const existing = contactData.data[0];
    if (existing.email !== email || existing.name !== email) {
      await fetch(`https://api.intercom.io/contacts/${contactId}`, {
        method: "PUT",
        headers: intercomHeaders,
        body: JSON.stringify({ email, name: email }),
      });
    }
  }
}
```

After editing, redeploy the `slack-interactions` edge function.

