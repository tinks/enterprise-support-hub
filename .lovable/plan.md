

## Update project knowledge file with all missing documentation

### What's missing

The knowledge file was last updated 2026-03-18 and is missing significant features added since then. Here is everything that needs to be added or corrected:

### 1. Fix routing table (Section 2 — UI Pages)
Current doc says `/` is Settings. Actual routes:

| Route | Page | Purpose |
|---|---|---|
| `/` | Stats | Dashboard with KPI cards, charts, filters |
| `/conversations` | Conversations | Unified Slack + Gmail conversation management |
| `/conversations/:id` | Conversation detail | Thread view with status controls |
| `/settings` | Settings (Index) | Configure channels, Intercom IDs, testing mode, Gmail OAuth |
| `/flow` | Flow diagram | Interactive workflow visualisation |
| `/knowledge` | Project knowledge | Markdown knowledge base with review workflow |

### 2. Add Gmail integration section (new section ~Section 19)
Document the full Gmail monitoring system:
- **Edge functions:** `poll-gmail` (cron every 15 min), `gmail-auth-url`, `gmail-oauth-callback`, `backfill-gmail-headers`
- **Tables:** `gmail_conversations` (message metadata, status, test/bug/product area), `gmail_oauth_tokens` (OAuth credentials, RLS denies all public access)
- Read-only integration for EnterpriseSupportDL Google Group
- High-water mark polling via `settings.gmail_last_polled_at`
- Token refresh logic when near expiry

### 3. Add missing tables to Section 2 architecture
Add to database tables list:
- `gmail_conversations` — Gmail thread metadata and status tracking
- `gmail_oauth_tokens` — OAuth tokens for Gmail API access
- `knowledge_documents` — Project knowledge content and pending changes

### 4. Add missing edge functions to Section 2 architecture
- `poll-gmail`, `gmail-auth-url`, `gmail-oauth-callback`, `backfill-gmail-headers`, `list-slack-users`

### 5. Add Product area and Bug columns documentation
Both `conversation_mappings` and `gmail_conversations` now have:
- `product_area` (text, nullable) — dropdown options: SSO, SCIM, Credits, Account access, Remix/transfer
- `is_bug` (boolean, default false) — toggle to flag bugs

### 6. Add Resolved toggle documentation
The Conversations page has independent toggles:
- **Test** — excludes from stats
- **Resolved** — marks as resolved (sets `status` to `resolved` / `resolved_at`)
- These are fully separate columns, not shared

### 7. Add Stats page documentation (new section ~Section 20)
- KPI cards: total conversations, Gmail resolved (deduped by subject), Slack resolved, escalation rate, avg resolution time
- Charts: daily volume, daily outcomes, status distribution pie, conversations by channel, cumulative trend, hourly activity, escalation rate trend, heatmap
- Filters: environment (live/test/all), source (all/slack/gmail), time range, custom date range, channel multi-select
- Heatmap drill-down: clicking a cell navigates to `/conversations?day=...&hour=...&source=...`
- Gmail resolved dedup: groups by subject, counts unique subjects (orphan rows without subject count individually)
- Brand colour palette: coral `#FF6B6B`, pink `#E66FD2`, purple `#9B87F5`

### 8. Add undocumented settings fields to Section 11
- `test_intercom_inbox_id` — separate Intercom inbox for test-mode conversations
- `auto_mark_employee_test` — auto-flag Lovable employee conversations as test
- `gmail_last_polled_at` — high-water mark for Gmail polling

### 9. Add Gmail secrets to Section 12
- `GMAIL_CLIENT_ID` — Google OAuth client ID
- `GMAIL_CLIENT_SECRET` — Google OAuth client secret

### Implementation
Use the knowledge document pending content workflow:
1. Read current content from `knowledge_documents`
2. Write the updated full document to `pending_content` with a `pending_summary`
3. User reviews and approves in the Knowledge tab

### Files to edit
- Database update only (write to `pending_content` column on `knowledge_documents` table via Supabase)

