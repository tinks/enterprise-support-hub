

## Why duplicates keep happening + the fix

### Root cause

Email → `enterprise-support@lovable.dev` → Google Group → simultaneously:
- **Intercom** creates a ticket and fires the webhook within **seconds**
- **Gmail** receives the message, but `poll-gmail` only runs **every 15 minutes**

So when `intercom-webhook` runs its "is there a matching Gmail row?" check, the Gmail row doesn't exist yet 90% of the time. Existing email + subject linkers can't match what isn't there → falls through to creating a `manual_conversations` stub. Then 5–15 min later `poll-gmail` inserts the Gmail row, our existing reconciler stamps the same `intercom_conversation_id` on it, and now both rows exist pointing at the same Intercom ticket. **Today's Experian case had an 88-second lag — fastest possible, and it still raced.**

Compounding this: when mail arrives via the Google Group, Intercom's contact email is often `enterprise-support@lovable.dev` (the group alias), not the customer. So even when the Gmail row exists, the email-based linker can miss because it searches for the wrong email.

### The fix — three layers

**1. Deferred linking on the webhook (primary fix).** When `intercom-webhook` fires for a Google-Group / `enterprise-support@lovable.dev`-contact ticket and finds NO matching Gmail row by email or subject, instead of immediately creating a manual stub, write a **pending link record** keyed on the Intercom ID + normalized subject + Intercom `created_at`. Skip the manual insert entirely for now. The pending record holds the Intercom ticket "in escrow" for up to 20 min waiting for Gmail to catch up.

**2. Reconciliation in `poll-gmail` (close the race).** After `poll-gmail` inserts new Gmail rows, scan `pending_intercom_links` for entries whose normalized subject matches one of the just-inserted Gmail threads AND whose Intercom `created_at` is within ±15 min of the Gmail `received_at`. On match: stamp the Gmail thread with `intercom_conversation_id`, delete the pending record. No manual stub ever gets created.

**3. Fallback after timeout (safety net).** If a pending record sits for >20 min with no Gmail match (real cases where the email never arrives, e.g. customer used Intercom Messenger or a non-Group address), a small cron promotes it into `manual_conversations` the same way today's webhook does. This preserves current behavior for the non-Google-Group case without ever creating a duplicate.

### Detect Google-Group contact correctly

The current email linker searches `from_email/to_emails/cc_emails` for the Intercom contact email. When the contact IS `enterprise-support@lovable.dev`, this matches every Gmail row in the DB and falls through to the (unlinked-only) filter unhelpfully. Add an explicit guard: **if Intercom contact email = `enterprise-support@lovable.dev`** (or any other group alias in settings), skip the email-linker and go straight to subject-matching, AND extract the real customer email from the Gmail row's `cc_emails` once it exists, so reconciler logic uses the right address.

### Schema additions

```sql
create table public.pending_intercom_links (
  id uuid primary key default gen_random_uuid(),
  intercom_conversation_id text not null unique,
  normalized_subject text not null,
  intercom_created_at timestamptz not null,
  contact_name text,
  contact_email text,
  resolved_owner text,
  source_payload jsonb not null,        -- full Intercom convo for later promotion
  pre_messages jsonb not null,          -- pre-extracted messages
  attempts int not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);
create index on pending_intercom_links (normalized_subject);
create index on pending_intercom_links (intercom_created_at);
```

RLS: deny public, allow authenticated read (for debugging UI later if needed).

### Edge function changes

- **`intercom-webhook`** — replace the "create manual stub" fallback in the auto-import path with: insert into `pending_intercom_links` (with full source payload + extracted messages), return success. Add Google-Group-alias guard before the email-linker.
- **`poll-gmail`** — after inserting new Gmail rows, query `pending_intercom_links` where `normalized_subject` matches AND `|intercom_created_at - received_at| < 15 min`. On match: stamp Gmail rows + delete pending. Log every reconciliation.
- **New `promote-pending-intercom-links` function** — runs every 2 min via pg_cron. For pending records older than 20 min with no Gmail match, promote to `manual_conversations` + `manual_messages` exactly like today's auto-import path. This is the safety net for real "no Gmail" cases.
- **Optional**: a "Pending links" admin tab (Index page) showing how many are in-flight, age, and a manual "promote now" button. Skip in v1 unless you want it.

### Migration tasks

1. Create `pending_intercom_links` table + RLS.
2. Create pg_cron job `promote-pending-intercom-links-every-2min`.
3. Update `intercom-webhook`: alias guard + replace manual-stub fallback with pending insert.
4. Update `poll-gmail`: post-insert reconciliation pass.
5. Create `promote-pending-intercom-links` edge function.
6. Update `.lovable/project-knowledge.md` and Flow diagram with the new race-prevention layer.
7. Save a memory file `mem://logic/pending-intercom-links` describing the new flow so it doesn't get re-introduced as a bug later.

### What this changes about the user experience

- **Inbox**: a new Intercom ticket from a Google-Group email won't appear as a row until either (a) the matching Gmail thread is detected (within 15 min, normal case) or (b) 20 min elapses (rare edge case where mail never reached our Gmail). In normal operation this means the ticket appears as a single Gmail row with `intercom_conversation_id` linked — exactly the right outcome.
- **Replies**: the `intercom-webhook` reply path (separate from auto-import) is unaffected; replies still process immediately against existing rows. If a reply arrives BEFORE the pending link resolves, the reply handler will find the pending row and immediately promote-and-update OR queue itself behind it. Need to confirm reply handler behavior — will check during implementation.
- **Cleanup**: the duplicates we already cleaned (24 rows yesterday) won't reappear from this flow.

### Out of scope

- Any change to Slack-bot-originated ticket creation (different code path, no race).
- Any change to `bulk-import-intercom` or manual paste tools.
- Backfilling historical pending records (nothing to backfill — this only affects future tickets).

