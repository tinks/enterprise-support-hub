

## Bug: wrong email on Intercom ticket (race condition)

### Root cause

When two tickets are created from the **same Slack user** with **different emails**, the second ticket overwrites the first contact's email. Here's the sequence:

1. **Ticket 1** (email: `josef.vilimek@sap.com`) — no Intercom contact exists yet, so one is created with `external_id = <your Slack user ID>` and email = `josef.vilimek@sap.com`. Contact ID saved.

2. **Ticket 2** (email: `liad.shiri@sap.com`) — searches Intercom by email `liad.shiri@sap.com`, finds nothing. Tries to **create** a new contact with the same `external_id`. Intercom rejects it as a **conflict** (duplicate `external_id`). The conflict handler (line 280) extracts the existing contact ID (the one from step 1) and then **overwrites its email** to `liad.shiri@sap.com` (line 284-289).

Now both tickets point to the same contact, and that contact's email is `liad.shiri@sap.com` — ticket 1's email (`josef.vilimek@sap.com`) is gone.

### Fix

In the conflict handler, **stop overwriting the email** when the existing contact already has a different email. Instead, search by email first, and only fall back to `external_id` if no email was provided. When a conflict occurs on `external_id` but the user supplied a different email, create the contact **without** `external_id` so each email gets its own Intercom contact.

### Changes

**File: `supabase/functions/slack-interactions/index.ts`** — `createIntercomTicket` function (lines 225-298)

1. When an email is provided and the initial email search finds no match, attempt to create the contact **without `external_id`** (use email as the unique identifier instead). This prevents the `external_id` conflict from merging unrelated emails into one contact.

2. Only set `external_id` on the contact when **no email** is provided (anonymous Slack user fallback).

3. In the conflict handler, do **not** overwrite the email if the existing contact already has a different email set. Instead, log a warning and use the conflicting contact as-is.

4. Update the Flow diagram page to reflect this fix.

### Technical detail

```text
BEFORE (buggy):
  create contact { external_id: slackUserId, email: newEmail }
  → conflict on external_id
  → reuse contact, overwrite email ← BUG

AFTER (fixed):
  if email provided:
    create contact { email: newEmail }  (no external_id)
    → no conflict, separate contact per email
  if no email:
    create contact { external_id: slackUserId }
    → conflict handler reuses contact WITHOUT overwriting email
```

