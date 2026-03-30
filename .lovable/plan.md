

## Update knowledge base with recent changes

### What's being added

Three sections of new documentation will be submitted as `pending_content`:

**1. Gmail integration (new §23)**
- New `gmail_conversations` table (columns: gmail_message_id, gmail_thread_id, from_email, from_name, subject, received_at, snippet, is_test)
- New `poll-gmail` edge function: polls Gmail DL every 15 min via connector gateway, inserts with `ON CONFLICT DO NOTHING` dedup
- `pg_cron` job: `poll-gmail-every-15-min` runs every 15 minutes
- New `gmail_last_polled_at` column in `settings` table
- Required secrets: `LOVABLE_API_KEY`, `GOOGLE_MAIL_API_KEY` (connector gateway)
- Conversations page: unified view with source filter (All/Slack/Gmail), Gmail rows show Mail badge and link to Gmail threads
- Stats page: source filter, Gmail volume card, dual-area chart overlaying Slack and Gmail volume

**2. Employee admin ID attribution (addition to §17 sender attribution)**
- Hardcoded `EMPLOYEE_ADMIN_IDS` map: `joel@lovable.dev → 8430778`, `kristina@lovable.dev → 9985999`
- Employee replies use the real admin's Intercom ID instead of Sam's, preventing auto-assignment/close
- Falls back to Sam's `intercom_assignee_id` if email not in map

**3. Fetch thread messages (addition to §2 architecture table + conversation detail §)**
- New edge function `fetch-thread-messages`: fetches full Slack thread via `conversations.replies` with cursor pagination
- Conversation detail page now shows a full message timeline with bot/user/employee attribution

### Updates to existing sections
- §2 Edge Functions table: add `poll-gmail` and `fetch-thread-messages` rows
- §2 Database Tables: add `gmail_conversations` row
- §12 Required Secrets: add `LOVABLE_API_KEY` and `GOOGLE_MAIL_API_KEY`
- §11 Configuration: add `gmail_last_polled_at` field
- Update last-updated date to 2026-03-30

### How
- Read current `content` from `knowledge_documents`
- Apply all changes to produce updated document
- Write to `pending_content` + `pending_summary` via database update
- User reviews and approves in Knowledge tab

### Files changed
- No code files — 1 database update (`knowledge_documents.pending_content` + `pending_summary`)

