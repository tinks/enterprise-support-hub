

## Update project knowledge document to reflect all current features

### Gaps identified

The knowledge file (sections 1–18) was written before Gmail integration, stats enhancements, and several recent changes. The following are **not documented at all**:

1. **Architecture — missing edge functions**: `poll-gmail`, `gmail-auth-url`, `gmail-oauth-callback`, `backfill-gmail-headers`, `context-reminder` (listed in 14b but not in the architecture table)
2. **Architecture — missing database tables**: `gmail_conversations`, `gmail_oauth_tokens`, `knowledge_documents` (mentioned in §18 but not in §2 table)
3. **Architecture — missing UI routes**: `/knowledge` (Knowledge page), `/stats` description is too vague
4. **Gmail integration section (entirely new)**: OAuth flow, poll-gmail cron (every 15 min), gmail_conversations schema (`subject`, `from_email`, `to_emails`, `cc_emails`, `gmail_thread_id`, `gmail_message_id`, `status`, `resolved_at`, `snippet`, `is_test`), read-only metadata tracking
5. **Hybrid Gmail resolution tracking**: `status` and `resolved_at` columns on `gmail_conversations`, `auto_close_gmail_threads` database function called by pg_cron daily, 24-hour inactivity auto-close logic, manual resolve from Conversations page
6. **Stats page analytics**: Three source filters (All/Slack/Gmail), Gmail metrics (Email total deduplicated by subject, Gmail messages raw count, Gmail open/resolved, median/avg resolution time), threads by customer domain (non-lovable.dev domain extraction from To/CC/From with RFC format parsing), internal-only email exclusion (all participants @lovable.dev), activity by hour of day (CET) chart, conversation volume overlay
7. **Gmail To/CC header extraction**: `poll-gmail` extracts To and CC headers, `backfill-gmail-headers` one-time function for existing rows
8. **Required secrets — missing**: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`
9. **Slack reply forwarding fix**: Thread replies after escalation now forward to Intercom inline (not in background) to prevent silent failures; cosmetic work (button removal, notices) remains in `EdgeRuntime.waitUntil()`

### Changes to make

Write to `pending_content` and `pending_summary` on the `knowledge_documents` table with an updated document that adds/modifies:

- **§2 Architecture**: Add missing edge functions, database tables, and UI routes to the tables
- **§11 Configuration**: Add `gmail_last_polled_at` field
- **§12 Required secrets**: Add `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`
- **New §19 — Gmail integration**: OAuth setup, poll-gmail cron, gmail_conversations schema, read-only metadata tracking
- **New §20 — Gmail resolution tracking**: Hybrid approach with manual resolve + 24h auto-close cron
- **New §21 — Stats & analytics**: Source filtering, all Slack metrics, all Gmail metrics (including dedup logic, internal exclusion, customer domain extraction, RFC email parsing), hourly activity chart (CET), volume overlay
- **§6 Step 6b-i / 6c**: Note that Intercom forwarding is now inline, cosmetic work in background

### How

- Single database UPDATE to `knowledge_documents` setting `pending_content`, `pending_summary`, `pending_at`
- User reviews diff in the Knowledge tab and approves/rejects
- No code file changes

