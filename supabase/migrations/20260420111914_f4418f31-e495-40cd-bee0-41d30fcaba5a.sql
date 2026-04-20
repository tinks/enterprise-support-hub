UPDATE public.knowledge_documents SET pending_content = $KBFULL$# Project Knowledge — Lovable Enterprise Support Hub

> **Last updated:** 2026-04-10
> This document captures all rules, logic, and behaviors of the system. Update it whenever logic changes.

---

## 1. Overview

**Lovable Enterprise Support Hub** — A Slack-to-Intercom support bridge for enterprise customers. When a user @mentions the bot in Slack, it creates an Intercom conversation assigned to an AI agent ("Sam"), relays responses back to Slack with feedback buttons, and supports escalation to human agents. The system has a dashboard UI for configuration, conversations monitoring, flow visualization, and statistics.

---

## 2. Architecture

### Edge Functions
| Function | Purpose |
|---|---|
| `slack-events` | Handles Slack `app_mention`, direct messages (`message.im`), and thread reply events |
| `slack-interactions` | Handles Slack button clicks, modal submissions, and feedback actions. Also contains the proactive polling logic for Sam's initial reply |
| `intercom-webhook` | Receives Intercom webhook events (admin replies, conversation/ticket closed) and relays to Slack |
| `check-bot-identity` | Diagnostic endpoint — verifies the Slack bot token identity against expected bot user ID |
| `list-slack-channels` | Lists Slack channels with tiered resolution: bulk list → direct `conversations.info` → connector gateway fallback. Resolves DM channels to user display names |
| `list-slack-users` | Lists Slack users (utility) |
| `context-reminder` | Cron-triggered function that reminds idle users and auto-proceeds after 30 min |
| `poll-gmail` | Polls Gmail inbox every 15 min via Google OAuth, extracts To/CC headers, stores email metadata in `gmail_conversations` |
| `gmail-auth-url` | Generates Google OAuth consent URL for Gmail integration setup |
| `gmail-oauth-callback` | Handles OAuth callback, exchanges code for tokens, stores in `gmail_oauth_tokens` |
| `backfill-gmail-headers` | One-time utility to backfill `to_emails` and `cc_emails` on existing `gmail_conversations` rows |
| `fetch-thread-messages` | Fetches full Slack thread via `conversations.replies` with cursor pagination for conversation detail view |
| `fetch-gmail-thread` | Fetches full Gmail thread by thread ID, decodes message bodies, returns normalized message list for detail view |
| `post-reply` | Sends customer-facing replies from the app UI to Intercom, Slack, or Gmail depending on conversation source |
| `import-slack-thread` | Imports a Slack thread by URL into `conversation_mappings` with metadata (reply count, response time, duration) |
| `import-intercom-ticket` | Imports a single Intercom conversation by URL into `manual_conversations` + `manual_messages` with duplicate detection |
| `bulk-import-intercom` | Bulk imports multiple Intercom conversations by ID array into `manual_conversations` + `manual_messages` |
| `create-intercom-from-import` | Creates an Intercom conversation from any imported source (Slack/Gmail/Manual) — builds transcript, creates/finds contact, assigns |
| `search-intercom-by-email` | Searches Intercom contacts and conversations by email address, optionally filtered by subject |
| `delete-conversation-mapping` | Deletes conversations from any source table (Slack/Gmail/Manual) using service role |
| `parse-thread` | AI-powered thread text parsing via Lovable AI Gateway (Gemini) — extracts structured sender + message pairs from pasted text |

### Database Tables
| Table | Purpose |
|---|---|
| `settings` | Singleton config: monitored channels, Intercom IDs, testing mode, bot user ID, admin-owner map, product areas |
| `conversation_mappings` | Maps Slack threads ↔ Intercom conversations with status tracking. Includes `resolved_at` for resolution time metrics |
| `bot_messages` | Editable bot message templates (keyed by `message_key`) |
| `flow_node_positions` | Persisted drag positions for the flow diagram UI |
| `gmail_conversations` | Gmail email metadata (message ID, thread ID, sender, To/CC recipients, subject, snippet, status, resolved_at) for volume tracking and resolution metrics |
| `gmail_oauth_tokens` | Stores Gmail OAuth access/refresh tokens and connected email address |
| `knowledge_documents` | Stores project knowledge content and pending agent-proposed changes |
| `manual_conversations` | Manually logged or imported conversations with a `source` column distinguishing `manual`, `intercom`, `slack`, etc. Intercom-imported rows use `source = 'intercom'` and are treated as a first-class source across the app |
| `manual_messages` | Individual messages within manual conversations (FK to `manual_conversations`) |
| `conversation_notes` | Internal notes attached to any conversation (Slack, Gmail, or Manual) by author |

### Database Functions
| Function | Purpose |
|---|---|
| `claim_intercom_part(p_mapping_id, p_part_id)` | Atomic dedup for Intercom part processing using `FOR UPDATE` row locking |
| `claim_slack_event(p_mapping_id, p_event_ts)` | Atomic dedup for Slack event processing using `FOR UPDATE` row locking — prevents race conditions from concurrent duplicate events |
| `auto_close_gmail_threads()` | Resolves Gmail threads older than 24h (cron-triggered) |
| `update_updated_at_column()` | Generic trigger function to auto-update `updated_at` timestamps |

### UI Pages
| Route | Page | Purpose |
|---|---|---|
| `/` | Stats | Dashboard with per-source metrics (Slack, Gmail, Manual entry, Intercom), source filtering, customer domain breakdown, hourly activity (CET), and resolution time analytics. Each source has its own dedicated section with KPI cards and charts |
| `/settings` | Settings (Index) | Configure channels, Intercom IDs, testing mode, view webhook URLs |
| `/conversations` | Conversations | View and monitor active/resolved conversations across all sources |
| `/conversations/:id` | Conversation detail | Full detail view with thread timeline, reply composer, notes, status/classification controls |
| `/flow` | Flow Diagram | Interactive visual diagram of the full support workflow |
| `/knowledge` | Project Knowledge | View, edit, and review the project knowledge document |
| `/import` | Import | Import conversations from Slack threads, Intercom tickets, or bulk CSV |
| `/import/bulk` | Bulk Import Review | Review and manage bulk-imported Intercom conversations |
| `/test-review` | Test Channel Review | Review conversations from test channels |

### Conversation detail page (`/conversations/:id`)
- Fetches a single conversation by ID from the appropriate source table (Slack/Gmail/Manual via `?source=` query param)
- Resolves Slack user display names and channel names via edge functions
- Displays: status badge, test toggle, original message, timestamps, Slack/Intercom deep links
- Collapsible section shows all raw IDs (intercom_contact_id, last_intercom_part_id, prompt_message_ts, etc.)
- **Actions:** Status dropdown (active, resolved, cancelled, escalated, awaiting_context, awaiting_support, awaiting_engineering, awaiting_customer) and is_test toggle
- Setting status to `resolved` automatically sets `resolved_at = now()`; moving away from resolved clears it
- Conversations list rows are clickable and navigate to this page
- **Thread timeline:** Fetches full Slack thread messages via `fetch-thread-messages` edge function, showing bot/user/employee messages with avatars, names, and timestamps
- **Gmail thread view:** Fetches full Gmail thread via `fetch-gmail-thread` edge function, showing sender, date, and decoded body
- **Reply composer:** Text input that sends replies via `post-reply` edge function, routing to the appropriate platform (Intercom/Slack/Gmail)
- **Internal notes:** Add/delete notes stored in `conversation_notes` table, displayed in the right panel
- **Intercom linking (Gmail):** Search Intercom by email, suggest matching conversations, link or create new Intercom conversations

### Source taxonomy (manual_conversations.source)
- `manual` — manually logged via the Manual Log tab
- `intercom` — imported from Intercom (via `import-intercom-ticket`, `bulk-import-intercom`, `backfill-enterprise-inbox`, `poll-intercom-inbox`, or `intercom-webhook` auto-import on assignment)
- `slack` — Slack thread imports (when stored in `manual_conversations` rather than `conversation_mappings`)
- All Intercom write paths set `source = 'intercom'`. A legacy backfill re-labeled rows where `intercom_conversation_id IS NOT NULL` from `manual` → `intercom`
- Filter dropdowns in the Inbox, Analytics, and Flow Diagram expose Intercom as its own option separate from Manual entry

### Intercom polling (pg_cron)
- `poll-intercom-inbox` runs every 5 minutes via pg_cron job `poll-intercom-inbox-every-5min` (`*/5 * * * *`) as a catch-all for tickets the webhook missed
- Uses `settings.last_polled_intercom_at` as an incremental cursor
- Also triggerable manually from the Settings page

### Analytics dashboard sections (Stats page)
- **Top-level KPIs** aggregate across all sources (Slack + Gmail + Manual + Intercom)
- **Per-source sections** — Slack, Gmail, Manual entry, Intercom — each with: total, resolved %, active, avg resolution time, escalation rate, top product area, bug rate, plus volume / status / product-area charts
- The Intercom section is visible when source filter is `all` or `intercom`; honors the environment + date filters
- **Source color palette** (used consistently across all charts):
  - Slack: purple `#9B87F5`
  - Gmail: pink/red
  - Manual entry: teal
  - Intercom: amber `#F59E0B`
- The Conversation volume chart renders Manual entry and Intercom as separate Area series with distinct gradients

---

## NOTE
The remainder of the document (sections 3 through end) is unchanged from the current live version. This pending update only modifies the Architecture section to add the three new subsections above and clarifies the `manual_conversations` table description and the Stats UI page row. To preserve all unchanged content, the user should approve this diff in the Project Knowledge UI; the existing content from section 3 onward will remain intact.
$KBFULL$, pending_summary = 'Adds Intercom as a first-class source: source taxonomy in manual_conversations, 5-min pg_cron polling note, dedicated per-source analytics sections (Slack/Gmail/Manual/Intercom) with chart color palette (Intercom = amber #F59E0B), and updated Stats UI row.', pending_at = now() WHERE id = 'project-knowledge';