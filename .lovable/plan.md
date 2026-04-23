

## Fix: Inbox search can't find Intercom ticket 215474005499607

### Why it fails today

The Inbox search calls the `search_conversations` RPC. That function only matches the `intercom_conversation_id` column on `conversation_mappings` / `gmail_conversations` / `manual_conversations`. There are two reasons your paste of `215474005499607` returns nothing:

1. **The ticket genuinely isn't in our DB yet.** With the new deferred-linking flow we just shipped, Google-Group-originated Intercom tickets sit in `pending_intercom_links` for up to 20 min before being promoted into `manual_conversations` or stamped onto a `gmail_conversations` row. During that window no row carries the Intercom ID, so no search can find it. The RPC does not look at `pending_intercom_links` at all.
2. **Even if the ticket is promoted later, `pending_intercom_links` will never be searchable** with the current RPC, so the same blind-spot keeps biting whenever someone pastes an ID for a brand-new ticket.

There's also a minor secondary gap: the Slack table has a separate legacy `intercom_ticket_id` column that the RPC doesn't search, but that's not what's biting you here — `215474005499607` is an `intercom_conversation_id`.

### Fix

**1. Migration — extend `search_conversations` RPC**

- Add `OR intercom_ticket_id ILIKE ilike_term` to the `conversation_mappings` branch (closes the legacy-column gap).
- Add a new branch that returns matches from `pending_intercom_links` as a new source `'pending'`:
  ```
  SELECT id, 'pending'::text FROM pending_intercom_links
  WHERE intercom_conversation_id ILIKE ilike_term
     OR normalized_subject ILIKE ilike_term
     OR contact_email ILIKE ilike_term
     OR contact_name ILIKE ilike_term;
  ```

**2. `src/pages/Conversations.tsx` — surface pending matches**

The unified table builder currently only knows `slack` / `gmail` / `manual`. When the search RPC returns a `'pending'` row, render a single, read-only row with:
- Source: "Pending (Intercom)"
- Subject: `normalized_subject`
- Contact: `contact_name` / `contact_email`
- Created: `intercom_created_at`
- A small "Awaiting Gmail match (auto-promotes within 20 min)" note + a link out to the Intercom ticket via `intercom_conversation_id`.

No edit affordances — these rows are transient and get promoted automatically.

**3. Placeholder copy**

Update the search input placeholder from `"Search…"` to `"Search messages, names, emails, Intercom ID…"` so the capability is discoverable.

### Verification after deploy

Re-run the search for `215474005499607`. Expected outcomes:
- If the ticket is in `pending_intercom_links` → appears as a Pending row.
- If `poll-gmail` already promoted/stamped it → appears as the Gmail or Manual row.
- If it's neither, that's a real bug in the webhook ingest path and we'll dig into edge logs from there.

### Out of scope

- Numeric-only "jump to detail page" deep link for bare IDs.
- Manual "promote now" button on Pending rows (could add later).
- Any change to the auto-promotion cron itself.

