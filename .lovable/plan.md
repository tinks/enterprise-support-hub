

## Update project knowledge file with missing documentation

### Problem
The knowledge file (last updated 2026-03-18) is missing documentation for many features added since then, including 15+ edge functions, new database tables/functions, UI routes, and recent logic changes.

### Missing items identified

**Edge Functions (15 undocumented):**
- `post-reply` — sends customer-facing replies from the app to Intercom, Slack, or Gmail
- `poll-gmail` — polls Gmail for new messages, inserts into `gmail_conversations`
- `gmail-auth-url` / `gmail-oauth-callback` — Gmail OAuth flow
- `fetch-gmail-thread` — fetches full Gmail thread for detail view
- `backfill-gmail-headers` — backfills To/Cc headers on existing Gmail rows
- `fetch-thread-messages` — fetches Slack thread messages for detail view
- `import-slack-thread` — imports a Slack thread by URL
- `import-intercom-ticket` — imports a single Intercom conversation
- `bulk-import-intercom` — bulk imports multiple Intercom conversations
- `create-intercom-from-import` — creates Intercom conversation from any imported source
- `search-intercom-by-email` — searches Intercom contacts by email
- `delete-conversation-mapping` — deletes conversations (Slack/Gmail/Manual)
- `parse-thread` — AI-powered thread text parsing

**Database additions:**
- `conversation_notes` table (notes on conversations)
- `claim_slack_event` PostgreSQL function (atomic dedup with `FOR UPDATE` locking)
- Settings fields: `admin_owner_map`, `product_areas`, `auto_mark_employee_test`, `test_intercom_inbox_id`, `gmail_last_polled_at`

**UI routes:**
- `/import/bulk` — Bulk import review page
- `/test-review` — Test channel review page

**Logic changes:**
- Gmail thread metadata inheritance (new messages inherit `owner`, `classification`, `product_area`, `is_bug`, `is_feature_request`, `intercom_conversation_id` from existing sibling rows)
- Slack event dedup upgraded from PostgREST update to `claim_slack_event` DB function
- Reply composer on conversation detail page (sends via `post-reply` edge function)

### Plan

Since the knowledge document requires user approval for AI changes, I will:

1. **Write the updated content to `pending_content`** in the `knowledge_documents` table with all missing sections added
2. **Set `pending_summary`** to describe the additions
3. The user can then review the diff in the Knowledge tab and approve/reject

### Sections to add/update

- **Section 2 (Architecture):** Expand edge functions table from 6 to 21 entries; add `conversation_notes` to database tables; add missing UI routes
- **Section 5 (Conversation Lifecycle):** Add additional statuses used by Gmail/Manual (`open`, `awaiting_support`, `awaiting_engineering`, `awaiting_customer`)
- **New Section 20: Gmail Integration** — OAuth flow, polling, thread metadata inheritance, backfill
- **New Section 21: Import System** — Slack thread import, Intercom import, bulk import, AI thread parsing
- **New Section 22: Post-Reply (Outbound Messages)** — Reply composer UI, edge function routing to Intercom/Slack/Gmail
- **New Section 23: Conversation Notes** — Internal notes system
- **New Section 24: Slack Event Dedup (claim_slack_event)** — DB function with row-level locking
- **Section 10 (Dedup):** Add `claim_slack_event` entry
- **Section 11 (Configuration):** Add missing settings fields
- **Section 12 (Required Secrets):** Add Gmail secrets (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`)

### Files to edit
- Database update via RPC: `knowledge_documents.pending_content` and `pending_summary` (requires edge function call or direct DB update)

