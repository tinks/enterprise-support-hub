

## Update project knowledge document

The knowledge file needs updates for three recent changes. I'll use the database migration approach (writing to `pending_content`) so you can review and approve in the Knowledge tab.

### Changes to document

1. **Section 4 (Step 4 — Intercom ticket created)**: Update the contact creation logic description. Previously it said contacts are created with `external_id` and handle 409 conflicts by extracting existing contact ID. Now: contacts are created **by email only** (no `external_id`) when an email is provided, preventing the race condition where two tickets from the same Slack user with different emails would merge into one contact. `external_id` is only used as fallback for anonymous tickets.

2. **Section 2 (Architecture — Edge Functions table)**: Add the `gmail-auth-url` and `gmail-oauth-callback` functions, and `poll-gmail` function. Add `gmail_conversations` and `gmail_oauth_tokens` to the database tables list.

3. **Section 2 (Architecture — UI Pages table)**: Add the `/knowledge` route (already exists but not in the table). Update `/conversations` description to mention the Intercom ID column.

4. **Section 12 (Required Secrets)**: Add `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` secrets used by the Gmail OAuth functions.

5. **Section 6c (User replies in thread)**: Add a note that replies to **resolved** conversations are silently dropped — the guard `status !== "resolved"` prevents forwarding.

### How it will be done

- Read current `content` from the `knowledge_documents` table
- Compose the updated document with the above changes
- Write to `pending_content` and `pending_summary` columns
- You'll see the diff in the Knowledge tab for review/approval

### Technical detail
- Single database UPDATE to `knowledge_documents` table setting `pending_content`, `pending_summary`, and `pending_at`
- No code file changes needed

