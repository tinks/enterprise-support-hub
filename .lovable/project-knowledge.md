# Project Knowledge — Slack ↔ Intercom Support Bridge

> This document captures all rules, logic, and behaviors of the system. Update it whenever logic changes.

---

## 1. Overview

A Slack-to-Intercom support bridge for enterprise customers. When a user @mentions the bot in Slack, it creates an Intercom conversation assigned to an AI agent ("Sam"), relays responses back to Slack with feedback buttons, and supports escalation to human agents. The system has a dashboard UI for configuration, conversations monitoring, flow visualization, and statistics.

---

## 2. Architecture

### Edge Functions
| Function | Purpose |
|---|---|
| `slack-events` | Handles Slack `app_mention` and `message` events (real-time mentions + thread replies) |
| `slack-interactions` | Handles Slack button clicks, modal submissions, and feedback actions. Also contains the proactive polling logic for Sam's initial reply |
| `intercom-webhook` | Receives Intercom webhook events (admin replies, conversation/ticket closed, notes) and relays to Slack / writes to manual tables |
| `check-bot-identity` | Diagnostic endpoint — verifies the Slack bot token identity against expected bot user ID |
| `list-slack-channels` | Lists Slack channels for the settings UI channel browser |
| `list-slack-users` | Lists Slack users (utility) |
| `poll-gmail` | 15-min cron: pulls new Gmail messages, upserts `gmail_conversations`, reconciles `pending_intercom_links` |
| `poll-intercom-inbox` | Cron reconciler that scans the Intercom inbox for tickets the webhook missed and imports them |
| `context-reminder` | 5-min cron: posts a reminder at 15 min and auto-creates the Intercom ticket at 30 min for stuck `awaiting_context` bot-flow conversations |
| `promote-pending-intercom-links` | 2-min cron: late-reconciles or promotes `pending_intercom_links` rows older than 20 min into `manual_conversations` |
| `backfill-intercom-replies` | Reconciliation that fetches missing Intercom parts (replies + notes) into `manual_messages`. `?recent=true` is also called by a 5-min cron as a webhook safety net |
| `backfill-enterprise-inbox` | One-shot/manual backfill of enterprise inbox Intercom conversations into `manual_conversations` |
| `backfill-gmail-headers` | Backfills missing `to_emails`/`cc_emails`/`from_*` on existing `gmail_conversations` rows |
| `backfill-slack-user-names` | Backfills `slack_user_name` on `conversation_mappings` from Slack profile lookups |
| `bulk-import-intercom` | Server side of the CSV / bulk import flow used by `/import/bulk` |
| `import-intercom-ticket` | Imports a single Intercom conversation (by ID/URL) into `manual_conversations` + `manual_messages` |
| `import-slack-thread` | Imports a single Slack thread URL into `manual_conversations` + `manual_messages`; `ImportTab` then auto-navigates to the new row |
| `create-intercom-from-import` | Creates a new Intercom conversation from a manually imported thread |
| `fetch-gmail-thread` | On-demand fetch of a Gmail thread's full message list |
| `fetch-thread-messages` | Generic thread-message fetcher used by the conversation detail UI |
| `gmail-auth-url` / `gmail-oauth-callback` | Gmail OAuth start + callback; tokens land in `gmail_oauth_tokens` |
| `parse-thread` | Pasted-text parser used by manual ingestion to split a transcript into messages |
| `post-reply` | Centralized outbound reply: routes to Slack, Intercom, or Gmail based on conversation source |
| `search-intercom-by-email` | Lookup helper: finds an Intercom contact + recent conversations by email |
| `cleanup-bad-intercom-imports` | Maintenance: removes malformed `manual_conversations` rows from earlier import bugs |
| `delete-conversation-mapping` | Admin-only deletion of a `conversation_mappings` row (used to retry from scratch) |
| `delete-slack-message` | Admin-only Slack message deletion (e.g., to remove an interim bot message) |

### Database Tables
| Table | Purpose |
|---|---|
| `settings` | Singleton config: monitored channels, Intercom IDs, testing mode, bot user ID, admin→owner map |
| `conversation_mappings` | Maps Slack threads ↔ Intercom conversations with status tracking |
| `bot_messages` | Editable bot message templates (keyed by `message_key`) |
| `flow_node_positions` | Persisted drag positions for the flow diagram UI |
| `knowledge_documents` | Project knowledge document with pending-change review workflow |
| `gmail_conversations` | Gmail-sourced conversations with thread tracking |
| `gmail_oauth_tokens` | OAuth tokens for Gmail integration |
| `manual_conversations` | Manually logged / Intercom-imported / Gmail-stub conversations from any source |
| `manual_messages` | Individual messages within manual conversations. Includes `is_internal_note` for Intercom notes |
| `conversation_notes` | User-authored inline yellow notes attached to any conversation (slack/gmail/manual) |
| `conversation_audit_logs` | Immutable old/new value history for metadata edits (owner, status, classification, resolved_at, etc.) |
| `pending_intercom_links` | Escrow table holding Intercom tickets for up to 20 min while `poll-gmail` tries to match them to a Gmail thread (closes the Google-Group race) |

### UI Pages
| Route | Page | Purpose |
|---|---|---|
| `/login` | Login | Supabase Auth sign-in (email + password / Google / SAML SSO) |
| `/` | Stats | Dashboard with per-source metrics. Top-level KPIs aggregate across Slack + Gmail + Manual + Intercom; each source has its own KPI section (total, resolved %, active, avg resolution time, escalation rate, top product area, bug rate) plus volume / status / product-area charts. Source color palette: Slack purple `#9B87F5`, Gmail pink/red, Manual entry teal, Intercom amber `#F59E0B`. The Conversation volume chart renders Manual entry and Intercom as separate Area series with distinct gradients, plus a dashed "Total" line (sourceFilter=all only) so daily totals are visually verifiable. **Dedup rules:** Gmail series dedupes against the full unfiltered dataset by `gmail_thread_id` (earliest row wins) before applying the date filter, so threads bucket on origin date. Intercom series skips any `manual_conversations` row whose `intercom_conversation_id` already appears on a Gmail thread — Gmail wins the attribution to prevent double-counting |
| `/conversations` | Conversations | Unified inbox — view and monitor active/resolved conversations across Slack, Gmail, manual |
| `/conversations/:id` | Conversation detail | Individual conversation thread view with metadata sidebar, notes, audit log. Status dropdown supports `active`, `resolved`, `cancelled`, `escalated`, `awaiting_context`, `awaiting_support`, `awaiting_engineering`, `awaiting_customer`. A collapsible section reveals all raw IDs (`intercom_contact_id`, `last_intercom_part_id`, `prompt_message_ts`, etc.). For Gmail rows, an Intercom-linking widget searches Intercom by email and lets the user link an existing conversation or create a new one |
| `/my/:owner` | Owner dashboard | Per-person dashboard (Joel, Kristina, Sam, CSM, Eren, Tine). Renders `<Conversations forceOwner={ownerName} key={ownerName} />` so each route remounts with its own state. **Defaults on dashboards:** Owner = route owner (read-only chip, not editable), Status hides only `resolved` (`DASHBOARD_HIDDEN`), all other filters cleared. The Filters panel shows no "active" badge in this clean state. Dashboard tinkering with Status / Product area / Classification does **not** persist to localStorage, so it can't leak into the inbox. `Reset` keeps the forced owner and restores `DASHBOARD_HIDDEN`. |
| `/import` | Import | Manual ingestion — paste, single URL (Slack thread / Intercom ticket), bulk |
| `/import/bulk` | Bulk import review | CSV bulk import preview + commit |
| `/test-review` | Test channel review | Triage view for the dedicated test inbox |
| `/settings` | Settings | Configure channels, Intercom IDs, admin→owner map, testing mode, view webhook URLs |
| `/flow` | Flow diagram | Interactive visual diagram of the full support workflow |
| `/knowledge` | Knowledge | View and edit this project knowledge document (with pending-diff review) |

### Source taxonomy (`manual_conversations.source`)
- `manual` — manually logged via the Manual Log tab
- `intercom` — imported from Intercom (via `import-intercom-ticket`, `bulk-import-intercom`, `backfill-enterprise-inbox`, `poll-intercom-inbox`, or `intercom-webhook` auto-import on assignment)
- `slack_thread` / `slack_dm` — Slack imports stored in `manual_conversations` (rather than `conversation_mappings`)
- All Intercom write paths set `source = 'intercom'`. A legacy backfill re-labeled rows where `intercom_conversation_id IS NOT NULL` from `manual` → `intercom`.
- Filter dropdowns in the Inbox, Analytics, and Flow Diagram expose Intercom as its own option separate from Manual entry.

---

## 3. Bot Identity

- **Bot name:** "Ask Lovable"
- **Avatar:** Hosted in Supabase Storage at `public-assets/bot-avatar/lovable-logo.png`
- **Identity constant** (used across all edge functions):
  ```js
  { username: "Ask Lovable", icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png" }
  ```

---

## 4. Security

### Slack Signature Verification
- All Slack-facing functions verify `x-slack-signature` using HMAC-SHA256 with `SLACK_SIGNING_SECRET`
- Timestamp must be within 300 seconds of current time

### Intercom Webhook Signature Verification
- Verifies `x-hub-signature` using HMAC-SHA1 with `INTERCOM_WEBHOOK_SECRET`

### Bot Identity Guard
- All three main edge functions (`slack-events`, `slack-interactions`, `intercom-webhook`) check that `SLACK_BOT_TOKEN` authenticates as the expected `slack_bot_user_id` from settings
- If mismatch → returns 403 and refuses to process
- `slack-interactions` caches the bot user ID per isolate for performance

---

## 5. Conversation Lifecycle & Statuses

### Status Flow
```
awaiting_context → processing → active ⇄ active_pending → resolved
                                  ↓
                              escalated ⇄ escalated_pending → resolved
```

| Status | Meaning |
|---|---|
| `awaiting_context` | Bot posted context prompt, waiting for user to click "Add Details" or "Proceed". Also used as the UI "Awaiting customer" label for manual status changes — but the cron only targets bot-flow instances (see §14b) |
| `processing` | User clicked a button, ticket creation in progress |
| `active` | Intercom conversation created, AI agent handling |
| `active_pending` | User sent a thread reply while active, waiting for Sam's response |
| `escalated` | User clicked 👎 or Sam auto-escalated |
| `escalated_pending` | User sent a thread reply while escalated, waiting for human response |
| `resolved` | User clicked 👍 or conversation/ticket closed in Intercom |

### Status Transitions (Atomic Guards)
- **All status transitions use atomic UPDATE with WHERE clause** — second click/event is a no-op
- `active → active_pending`: Only if status is exactly `active`
- `escalated → escalated_pending`: Only if status is exactly `escalated`
- `active_pending → active`: Reset by `intercom-webhook` when reply arrives
- `escalated_pending → escalated`: Reset by `intercom-webhook` when reply arrives
- Feedback buttons: Only fire if status is `active` or `awaiting_context`

### Reactions (Thread-level indicators)
| Emoji | Meaning | When Added | When Removed |
|---|---|---|---|
| 👀 (`eyes`) | Ticket created, being handled | On ticket creation | On resolve or escalate |
| ⏳ (`hourglass_flowing_sand`) | Escalated, waiting for human | On escalation | On resolve |
| ✅ (`white_check_mark`) | Resolved | On resolve | Never |

---

## 6. Step-by-Step Flow

### Step 1: User @mentions bot
- **Function:** `slack-events`
- Verifies Slack signature
- Auto-adds new channels to `monitored_channels` on first @mention (no manual setup needed)
- Atomic INSERT with `ON CONFLICT DO NOTHING` prevents race from Slack retries
- If thread reply → fetches full transcript via `conversations.replies`
- Collects file attachments from thread

### Step 2: Bot posts context prompt
- **Function:** `slack-events`
- Posts a Block Kit message with two buttons: "Add Details" (primary) and "Proceed"
- Message text is loaded from `bot_messages` table (key: `context_prompt`)
- Status: `awaiting_context`

### Step 3a: "Add Details" clicked
- **Function:** `slack-interactions`
- Opens Slack modal FIRST (time-sensitive `trigger_id` expires in 3s)
- Updates prompt message to "⏳ Gathering your details…" via `chat.update`
- Modal has two fields: Email (`email_text_input` with native validation) and Project Link
- `promptMessageTs` stored in modal `private_metadata`
- On submit → posts submitted details to thread for transparency, updates prompt message to ack, creates Intercom ticket
- On cancel (view_closed) → proceeds without context (same as "Proceed")

### Step 3b: "Proceed" clicked
- **Function:** `slack-interactions`
- Skips modal, creates ticket with original message only
- Updates prompt message to ack text via `chat.update`

### Step 4: Intercom ticket created
- **Function:** `slack-interactions` → `createIntercomTicket()`
- Adds 👀 reaction to original message
- Searches/creates Intercom contact (handles 409 Conflict by extracting existing contact ID from error message via regex)
- Downloads & re-hosts file attachments to Supabase Storage (`public-assets/slack-attachments/`)
- Prepends anti-escalation internal note to conversation body (key: `internal_note`)
- Creates conversation with text + attachment URLs
- Assigns to AI agent (from `settings.intercom_assignee_id`)
- Sets custom attributes: `Slack channel`, `source: Slack`, `support_tier: Enterprise Support`
- Sends group DM notification to hardcoded user IDs (Kristina & Joel)
- If testing mode → posts debug message with Intercom conversation ID

### Step 5: AI responds → posted to Slack
- **Primary path:** Proactive polling in `slack-interactions` at 10s/20s/30s/60s intervals after ticket creation
- **Fallback path:** `intercom-webhook` for subsequent replies
- **Internal note filtering:** Both paths skip `part_type === "note"` to prevent interim messages (e.g., "Sam is working…") from leaking to Slack
- **Deduplication:** Atomic UPDATE on `last_intercom_part_id` — first writer wins
- Removes old feedback buttons from thread before posting new reply
- **Escalation marker guard:** `intercom-webhook` skips its own customer-side marker text (`This ticket has been escalated — awaiting human support response.`) so Intercom cannot emit it back as `conversation.user.replied` and loop it into Slack repeatedly
- Converts HTML to Slack markdown (br→\n, p→\n\n, li→bullet, strips tags)
- Strips AI footers/sign-offs
- Splits messages at 2500 chars / 35 lines to avoid Slack's "See more" collapse
- Posts reply with divider + timestamp header + author attribution
- Forwards Intercom attachments + inline images (deduped) to Slack
- **Incident.io detection:** If reply references incident.io/status page → fetches live status from `status.lovable.dev` and posts status block with subscribe button; includes escalate button if not already escalated
- **Interim message detection:** Pattern matches "Sam is working/thinking/typing..." → no buttons posted
- **Auto-escalation detection:** Regex matches escalation keywords only on Sam/admin AI replies → hides feedback buttons, posts routing notice, sets status to `escalated`, swaps reactions (eyes→hourglass), converts conversation to ticket (ticket_type_id: "1")
- Normal replies → shows "👍 This resolved my issue" + "👎 Escalate to human" buttons + "continue chatting" hint

### Ticket ID extraction (intercom-webhook)
- For `ticket.*` topics, `item.id` may be a **part ID** not the conversation/ticket ID; the actual ID is at `item.ticket.id`
- ID extraction priority: ticket topics → `item.ticket.id` first; conversation topics → `item.id` first
- **Fallback mapping lookup:** if no mapping found for primary ID, tries alternative IDs from payload (`item.ticket.id`, `item.id`, `ticket_id`, `conversation_id`)
- **Parts fetch fallback:** if `/conversations/{id}` returns no parts, falls back to `/tickets/{id}` endpoint
- Enhanced diagnostic logging shows all payload IDs when no mapping found

### Step 6a: 👍 Positive feedback
- **Function:** `slack-interactions`
- Atomic guard: updates status to `resolved` only if currently `active` or `awaiting_context`
- Removes feedback buttons from thread
- Swaps reactions: removes eyes + hourglass, adds checkmark
- Closes Intercom conversation (keeps current admin)
- Posts resolution message (key: `feedback_positive`)

### Step 6b: 👎 Escalate to human
- **Function:** `slack-interactions`
- Atomic guard: updates status to `escalated` only if currently `active` or `awaiting_context`
- Removes feedback buttons
- Swaps reactions: removes eyes, adds hourglass
- Reassigns to enterprise team inbox (one-time, from `settings.intercom_inbox_id`)
- Converts conversation to ticket (ticket_type_id: "1")
- Posts escalation notice (key: `escalation_notice`)

### Step 6c: User replies in thread (active status)
- **Function:** `slack-events`
- Returns 200 immediately; processes in background via `EdgeRuntime.waitUntil()`
- Idempotency: deduplicates by `event.ts` via `last_processed_event_ts`
- Ignores bot messages and messages from the bot itself
- Removes old feedback buttons from thread
- Atomic status gate: `active → active_pending` (skips notice if already pending)
- Posts "⏳ Sam is writing a response..." only on successful transition
- Downloads & re-hosts any attached files
- Forwards reply + attachments to Intercom as the contact
- Loop continues until user clicks 👍 or 👎

### Step 6b-i: User replies in Slack (escalated status)
- **Function:** `slack-events`
- Same background processing pattern as 6c
- Atomic status gate: `escalated → escalated_pending`
- Downloads & re-hosts any attached files
- Forwards message + attachments to Intercom as the contact
- Posts "reply forwarded" notice only on successful transition (key: `reply_forwarded`)

### Step 6b-ii: Human agent replies from Intercom
- **Function:** `intercom-webhook`
- Removes old feedback buttons
- Posts reply with human admin identity (name + avatar from Intercom, fallback to Slack profile pic)
- Shows only "👍 This resolved my issue" button (no escalate button when already escalated)
- Includes "continue chatting" hint

### Step 7: Conversation/Ticket closed
- **Function:** `intercom-webhook`
- Handles `conversation.admin.closed` and `ticket.state.updated` topics
- Filters `ticket.state.updated` to only `resolved`/`closed` state categories
- Removes all feedback buttons from thread
- Swaps reactions: removes eyes + hourglass, adds checkmark
- Posts resolution notice (key: `conversation_closed`)
- Sets status to `resolved`

---

## 7. Message Processing Rules

### HTML → Slack Markdown Conversion
```
<br> → \n
</p> → \n\n
<li> → "• "
</li> → \n
<ul>/<ol> → \n
All other tags → stripped
3+ newlines → collapsed to \n\n
```

### Slack Markup Cleaning (outgoing to Intercom)
```
<mailto:x|y> → x (email)
<url|label> → url
<url> → url
<@USER_ID> → stripped
```

### AI Footer Stripping
- Removes "This message was..." suffixes
- Removes sign-off patterns (Best/Regards/Thanks/Cheers + name)

### Message Chunking
- Max 2500 characters OR 35 lines per chunk
- Splits at paragraph boundaries first, then line breaks, then hard character limit
- Only the last chunk gets feedback buttons

### Human Admin Identity
- If the Intercom reply author is a human admin (not "Sam" or "Ask Lovable"):
  - Fetches their avatar from Intercom API, falls back to Slack profile pic via email lookup
  - Overrides Slack message identity with admin's name and avatar
  - Only "👍 Resolved" button shown (no escalate)

---

## 8. Editable Bot Messages

Stored in `bot_messages` table, editable from the Flow Diagram UI:

| Key | Used In | Purpose |
|---|---|---|
| `context_prompt` | Step 2 | Initial message asking for email/project context |
| `ticket_created_ack` | Step 4 | Acknowledgment after ticket creation |
| `feedback_positive` | Step 6a | Message when user confirms resolution |
| `escalation_notice` | Step 6b | Message when escalating to human |
| `reply_forwarded` | Step 6b-i | Message when user's Slack reply is forwarded |
| `conversation_closed` | Step 7 | Message when conversation is closed from Intercom |
| `context_reminder` | Step 2 (cron) | Reminder posted after 15 min if user hasn't interacted with context prompt |
| `internal_note` | Step 4 | Anti-escalation context prepended to Intercom conversation body (not shown to user) |

---

## 9. File Handling

- **Max file size:** 50 MB (files exceeding this are silently skipped)
- **Storage path:** `public-assets/slack-attachments/{threadTs}/{safeName}`
- File names are sanitized: only `a-zA-Z0-9._-` characters kept
- Files are downloaded from Slack (using bot token auth) and re-hosted to Supabase Storage for permanence
- Thread files are collected from ALL messages in a thread on ticket creation
- Attachments from Intercom replies (both explicit and inline `<img>` tags) are forwarded to Slack

---

## 10. Deduplication Mechanisms

| Mechanism | Location | How It Works |
|---|---|---|
| Initial mention claim | `slack-events` | Atomic INSERT with `ON CONFLICT DO NOTHING` on `(slack_channel_id, slack_thread_ts)` |
| Thread reply dedup | `slack-events` | `last_processed_event_ts` compared to `event.ts` |
| Intercom part dedup (webhook) | `intercom-webhook` | Atomic UPDATE on `last_intercom_part_id` with conditional WHERE |
| Intercom part dedup (polling) | `slack-interactions` | Same atomic UPDATE pattern, `last_intercom_part_id` guard |
| Status transition guards | All functions | UPDATE with `eq("status", expectedStatus)` — second writer gets empty result |
| Intercom→Gmail subject tier | `intercom-webhook` | Normalizes Intercom ticket subject (strip `Re:`/`Fwd:`/`Fw:`, lowercase, collapse whitespace) and scans `gmail_conversations` from the last 14 days. Runs TWO checks in one pass: (a) **already-represented**: if any matched row has a non-null `intercom_conversation_id` different from the incoming one, log `subject_match_existing_gmail` and return early — skip stamping AND skip manual creation; (b) **stamp**: only if (a) found nothing, look at unlinked candidates and stamp if exactly one distinct thread matches. 0 or >1 distinct unlinked threads → log `subject_link_ambiguous` and fall through |
| Linker priority order (auto-import) | `intercom-webhook` | 1) email→Gmail thread, 2) subject→Gmail tier (14d, with already-represented check + stamp check), 3) subject→`manual_conversations` (7d) — exactly-one match logs `subject_match_existing_manual` and returns without creating a new manual row, 4) create new manual row. Critical: tier 2's "already-represented" check runs even when there's no unlinked thread to stamp — this prevents Google-Group duplicate Intercom tickets from creating duplicate manual rows when the original is in `gmail_conversations` |
| Thread-overwrite guards | `intercom-webhook` | Both Gmail linkers (email + subject stamp) check siblings on the target `gmail_thread_id`. If any sibling already has a non-null `intercom_conversation_id` that differs from the incoming ticket, log `email_link_conflict` / `subject_link_conflict` and return without overwriting. The thread-level UPDATE also uses `.or("intercom_conversation_id.is.null,intercom_conversation_id.eq.<newId>")` as defense-in-depth. The new Intercom ticket is treated as a duplicate; our DB already represents the conversation correctly |
| Reply reconciliation cron | `pg_cron` → `backfill-intercom-replies?recent=true` | Runs every 5 min as a safety net for any Intercom reply webhooks that get dropped, raced, or arrive on topics outside the whitelist. Targets `manual_conversations` and `gmail_conversations` with non-null `intercom_conversation_id` updated/received in the last 7 days, capped at 200 rows. Inserts missing `manual_messages` and resolves status mismatches |
| Manual message idempotency | `intercom-webhook` auto-import + `poll-intercom-inbox` | Intercom fires both `conversation.admin.assigned` and `conversation.admin.open.assigned` ~1s apart for the same logical event. Both reach the auto-import path concurrently; `manual_conversations` is safe via upsert, but `manual_messages` had no DB-level uniqueness and would double-insert. Before inserting, fetch existing rows for the conversation and dedup by key `${role}|${floor(created_at_ms/1000)}|${message_text}` so the second invocation is a no-op for messages |
| Pending Intercom links (deferred linking) | `intercom-webhook` + `poll-gmail` + `promote-pending-intercom-links` | Closes the webhook→poll-gmail race for Google-Group emails. Inbound mail to `enterprise-support@lovable.dev` arrives in Intercom within seconds but in Gmail only on the next 15-min poll. Instead of immediately creating a `manual_conversations` stub when all linker tiers miss, the webhook inserts into `pending_intercom_links` (full source payload + pre-extracted messages, keyed by `intercom_conversation_id`). `poll-gmail` then runs a reconciliation pass: for each pending row, find a Gmail thread with matching `normalized_subject` whose `received_at` is within ±15 min of `intercom_created_at`, stamp the thread, delete the pending row. The 2-min cron `promote-pending-intercom-links-every-2min` calls `promote-pending-intercom-links`, which late-reconciles any pending rows older than 20 min OR promotes them to `manual_conversations` if the Gmail row never arrived (e.g. Intercom Messenger, non-Group inbound). The webhook also skips the email-based gmail linker when the Intercom contact email is in `GROUP_ALIASES` OR ends in `@lovable.dev` (internal employees opening tickets on behalf of customers — their inbox has dozens of unrelated open threads and the most-recent-thread heuristic would mis-stamp). Logs `[email-linker-skip]` |
| Cross-thread link conflict guard (inverse uniqueness) | `intercom-webhook` email + subject tiers | Before stamping `intercom_conversation_id = X` onto a Gmail thread, queries whether `X` is already linked to a *different* `gmail_thread_id`. If so, refuses the stamp and logs `[cross_thread_link_conflict:email]` or `[cross_thread_link_conflict:subject]`. Complements the existing per-thread overwrite guard (which only catches "this thread already has a different Intercom id"). Together they prevent the bug where one Intercom ticket fans out across two unrelated Gmail threads (e.g. shared external email with simultaneous tickets) |

Realtime reply topic whitelist in `intercom-webhook` (`REPLY_TOPICS`): `conversation.admin.replied`, `conversation.admin.single.reply`, `ticket.admin.replied`, `conversation.user.replied`, `conversation.user.created`, `conversation.operator.replied`, `ticket.contact.replied`. Any topic that should sync into our DB must be added here AND subscribed in the Intercom webhook console.

---

## 11. Configuration (Settings Table)

| Field | Purpose |
|---|---|
| `monitored_channels` | Comma-separated Slack channel IDs (auto-expanded on first @mention) |
| `intercom_inbox_id` | Team inbox ID for human escalation reassignment |
| `intercom_assignee_id` | AI agent ID (Sam) for initial assignment + conversation close operations |
| `slack_bot_user_id` | Expected bot user ID for identity guard verification |
| `testing_mode` | When true, posts Intercom conversation IDs in Slack for debugging |

---

## 12. Required Secrets (Edge Function Environment)

| Secret | Used By |
|---|---|
| `SLACK_BOT_TOKEN` | All Slack-facing functions |
| `SLACK_SIGNING_SECRET` | `slack-events`, `slack-interactions` |
| `INTERCOM_API_TOKEN` | `slack-events`, `slack-interactions`, `intercom-webhook` |
| `INTERCOM_WEBHOOK_SECRET` | `intercom-webhook` |

---

## 13. Incident.io / Status Page Integration

- Triggered when Sam's reply contains keywords: `incident.io`, `status.lovable.dev`, `we have an incident`, `status page`
- Fetches live status from `https://status.lovable.dev/api/v2/summary.json`
- Posts a formatted status block with component statuses and emoji indicators
- Includes "Subscribe to status updates" button linking to status page
- Replaces `[App: incident.io]` references with actual status page URL

---

## 14. Auto-Escalation (Sam → Human)

Sam's replies are scanned for escalation keywords:
```regex
/\b(escalat|routing|transfer|hand(ing|ed)?\s*(this\s+)?(over|off)|human\s+(agent|support|team)|enterprise\s+(support\s+)?team|team\s+member|connect(ing)?\s+you\s+with|pass(ing)?\s+(this\s+)?(to|along))\b/i
```

When detected:
- Feedback buttons are hidden
- "_Sam has routed this to the Enterprise Support Team_" context note is displayed
- Status is set to `escalated`
- Reactions swapped: eyes → hourglass
- Applied in both polling path (`slack-interactions`) and webhook path (`intercom-webhook`)
- After escalation, a customer comment is posted to mark the ticket as "Waiting" in Intercom inbox

---

## 14b. Context Reminder & Auto-Proceed

A cron function (`context-reminder`) runs every 5 minutes and checks for conversations stuck in `awaiting_context`:

- **Only targets bot-flow conversations** — requires `prompt_message_ts IS NOT NULL` (set when the bot posts its "Add Details / Proceed / Cancel" buttons). Conversations where "Awaiting customer" was set manually via the UI are never processed.
- **Safety net:** Also requires `intercom_conversation_id IS NULL` — never auto-proceeds a conversation that already has an Intercom ticket.
- **15 minutes:** Posts a reminder in the Slack thread nudging the user to click "Add Details" or "Proceed"
- **30 minutes:** Automatically creates the Intercom ticket (same as clicking "Proceed") — looks up user email, creates contact + conversation, assigns to Sam

Dedup: `reminder_sent_at` prevents duplicate reminders; atomic status guard prevents double ticket creation. The `prompt_message_ts` column stores the bot's prompt message timestamp so it can be updated via `chat.update`.

---

## 15. Group DM Notifications

- On every ticket creation, a group DM is sent to hardcoded Slack user IDs: `U0AFU714807` (Kristina) and `U091GANMA2U` (Joel)
- Contains links to both the Slack thread and the Intercom conversation

---

## 16. Intercom API Version

All Intercom API calls use `Intercom-Version: 2.11`.

### Intercom custom-attribute mapping
On every import path, the Intercom REST response's `custom_attributes` are mapped onto the local row via a shared `extractIntercomCustomFields(icData)` helper:

- `custom_attributes["Affected Product Area"]` → `product_area`
- `custom_attributes["Ticket type"]` → `classification`

Empty/missing values are omitted so existing values are never overwritten with blank. Wired in `import-intercom-ticket`, `poll-intercom-inbox`, `intercom-webhook` (Gmail link payloads + `pending_intercom_links.source_payload`), and `promote-pending-intercom-links` (read back out of `source_payload`). The webhook's duplicate-detection early return does NOT re-fetch from Intercom and so does not refresh these fields on already-tracked rows — a backfill is required to populate historical imports.

---



## 17. Flow Diagram (UI)

- Interactive React Flow diagram showing the complete support workflow
- Nodes are draggable; positions are persisted to `flow_node_positions` table
- Bot message nodes are editable inline — changes save to `bot_messages` table and take effect immediately
- Supports PNG export via `html-to-image`
- **Rule:** Whenever logic changes are made, the Flow Diagram must be updated to stay in sync

---

## 18. Project Knowledge Document

- Stored in `knowledge_documents` table with columns: `content` (current approved), `pending_content` (proposed changes), `pending_summary` (change description)
- **CRITICAL RULE:** The AI agent must NEVER directly update the `content` column. Instead, it must write proposed changes to `pending_content` and a brief summary to `pending_summary`. The user reviews the diff in the Knowledge tab and clicks "Approve" or "Reject".
- The Knowledge page (`/knowledge`) shows a rendered markdown preview, an edit mode for manual edits, and a diff-based review mode for pending agent changes
- Manual edits by the user via the Edit mode save directly (no approval needed)
- Pending changes are highlighted with an orange banner across the UI
- The diff view uses LCS-based line comparison showing added (green) and removed (red) lines

### Agent Workflow for Updating Knowledge
1. Read current content: `SELECT content FROM knowledge_documents WHERE id = 'project-knowledge'`
2. Write proposed changes: `UPDATE knowledge_documents SET pending_content = '...', pending_summary = '...', pending_at = now() WHERE id = 'project-knowledge'`
3. Inform the user that changes are pending review in the Knowledge tab
4. **DO NOT** update the `content` column directly

---

## 19. Navigation Layout

### Collapsible sidebar
- Left sidebar collapses to **56px** (icon rail) and expands to **200px** on hover
- 2px vertical gradient accent on the left edge (primary → accent colors)
- Width transition uses `transition-all duration-300`

### Label visibility
- All nav rows use `overflow-hidden` (via shared `linkBase` class) to prevent text leaking when collapsed
- Labels animate between `max-w-0 opacity-0` (collapsed) and `max-w-[150px] opacity-100` (expanded)

### Controlled tooltips
- A single `activeTooltip` state ensures only one tooltip is visible at a time when the sidebar is collapsed
- Each `Tooltip` uses a controlled `open` prop: `open={!expanded && activeTooltip === item.label}`
- `activeTooltip` is cleared on sidebar expand and on mouse leave

### Dashboards flyout
- Joel and Kristina are grouped under a "Dashboards" parent item
- Hovering "Dashboards" reveals a flyout submenu rendered via `DropdownMenuPortal` so it is not clipped by the sidebar's scroll container
- The flyout uses a **150ms debounce** (`closeTimerRef`) so the menu stays mounted while the mouse crosses from the trigger to the submenu
- Clicking Joel or Kristina navigates to `/my/joel` or `/my/kristina` and closes the flyout
- When the mouse leaves both the sidebar and the flyout, everything collapses

---

## Analytics — channel drilldown

The "Conversations by channel" bar chart on the analytics dashboard is interactive:

- Each bar is clickable and navigates to the inbox with a pre-applied filter.
- Slack channel IDs starting with `D` (1:1 direct messages) are aggregated into a single synthetic bar labelled **"Direct message"** (`channel_id: "__DM__"`) so individual DM partners do not pollute the chart.
- Manually imported Slack threads (`manual_conversations.source = 'slack_thread'`) are also counted, keyed by the normalized `link` field. Normalization is intentionally minimal: lowercase, trim, and strip a single leading `#`. We do **not** collapse `_` ↔ `-` — channel name cleanup is done manually via the inbox UI.
- Manual `slack_dm` rows fold into the same "Direct message" bucket as auto-tracked DMs.
- Manual `slack_thread` rows with an empty/missing `link` are bucketed into a synthetic `#unknown` bar (`channel_id: "manual:__unknown__"`).
- Regular channels (`C…`) deep-link via `/conversations?channel=<id>&source=slack` and filter by exact `slack_channel_id`.
- The DM aggregate deep-links via `/conversations?channelGroup=dm&source=slack` and filters Slack rows where `slack_channel_id` starts with `D`.
- Manual buckets deep-link via `/conversations?manualChannel=<normalized-name>` (no `source=slack` — manual rows have `source='manual'` in DB) and filter manual rows by `normalizeChannelName(link) === param`. When `manualChannel` is present, the inbox forces `sourceFilter='manual'` so the manual loop runs. The `__unknown__` bucket matches manual rows with empty `link`.
- Manual channel names are stored in `manual_conversations.link` **without** a leading `#`. The `ManualLogTab` save handler strips a single leading `#` and trims whitespace before insert; the `#` is added back only at display time.
- The inbox shows a dismissible filter chip ("Showing conversations from channel #X", "Showing conversations from direct messages", or "Showing manually imported threads from #X") with a "Back to analytics" shortcut.
- Manual buckets and real `C…` bars with the same display name are kept separate (different `channel_id`) until names are reconciled manually.
- Legacy `G…` IDs (group DMs / old private channels) are intentionally **not** grouped — they keep their own bars since some are private channels with meaningful names.
- Channel chart counts respect the active date range filter at the top of analytics — a channel with 14 total rows in DB will show only those falling inside the selected window.

## Inbox — manual Slack imports

Manual rows with `source='slack_thread'` or `source='slack_dm'` are visually treated like normal Slack conversations in the inbox table:

- **Channel** column shows `#<normalizeChannelName(link)>` (or `#unknown` when `link` is empty) for `slack_thread`, and `Direct message` for `slack_dm`. The raw `source` string is no longer shown for these rows.
- **Link** column is suppressed for `slack_thread`/`slack_dm` (the `link` field holds a channel name, not a URL). For other manual sources, the link is rendered as an external link only when it matches `^https?://`.
- Inbox search (server-side `search_conversations` RPC) already covers `manual_conversations.link`, `subject`, `contact_name`, `status`, `owner`, `classification`, and `manual_messages.message_text` — no separate channel-name search path is needed.
- Empty-state message is channel-aware: when `?manualChannel=` is set and `unified` is empty, the message names the channel and suggests clearing status/owner/classification filters.
- **Manual channel drilldown overrides defaults**: when `?manualChannel=` is present, the inbox (a) bumps the per-source page size to 1000 so the full manual set is loaded (the default 50-row cap was hiding older rows), and (b) bypasses the default `hiddenStatuses` filter so resolved/test/cancelled rows in the channel are visible. Owner / product area / classification filters still apply and can be cleared from the chip.

## Conversations filter defaults — inbox vs dashboards

Two defaults coexist in `src/pages/Conversations.tsx`:

- `DEFAULT_HIDDEN = {test, cancelled, resolved}` — used on `/conversations` (the inbox). Persists user picks via `conv-hidden-statuses`, `conv-pa-filter`, `conv-class-filter`, `conv-owner-filter`.
- `DASHBOARD_HIDDEN = {resolved}` — used on `/my/<owner>` whenever `forceOwner` is set. Owner is locked to the route owner. localStorage writes for hidden statuses, product area, and classification are skipped while `forceOwner` is set so dashboards never overwrite inbox defaults.

`effectiveDefaultHidden = forceOwner ? DASHBOARD_HIDDEN : DEFAULT_HIDDEN` drives the "active filter" badge, the Status popover's "Restore defaults" button, and `resetAll`. The forced owner is excluded from the active-filter count.

## Inbox columns — order, visibility, sort

- **Order**: column headers in the Conversations table are drag-to-reorder. Order persists to localStorage `conv-column-order` (versioned via `conv-column-order-version`).
- **Visibility**: a "Columns (N/total)" popover in the inbox toolbar (next to Refresh) shows a checkbox per field. Selections persist to localStorage `conv-column-visibility`; at least one column must stay visible. "Show all" restores every column. Rendered columns are derived as `displayedColumns = columnOrder.filter(c => visibleColumns.has(c))`, and all body `colSpan`s use `displayedColumns.length`.
- **Sort**: the unified row list is globally sorted by `sortDate` desc after the Slack/Gmail/Manual sources are concatenated, so cross-source rows interleave strictly by date (newest first). There is no click-to-sort on headers yet.
- **ID display**: the `id` column shows the first 7 chars of the row UUID with full UUID on hover (`title`) and click-to-copy. Column width is 80px to fit 7 mono chars.
- **Cross-source dedup**: when a `gmail_conversations` row carries an `intercom_conversation_id`, any `manual_conversations` row sharing that id is suppressed from the unified list (Gmail wins). Mirrors the analytics dedup in `mem://logic/gmail-thread-dedup`.
- **Pagination dedup**: "Load more" appends new rows but filters out any id already present in `mappings` / `gmailRows` / `manualRows` to prevent the React duplicate-key warnings (and visual duplicate rows) that could appear when fresh inserts shift the server-side offset window.

## Resolution time — manual override

- The Conversation detail page (`/conversations/:id`) Timeline card lets users edit `resolved_at` for slack, gmail, and manual conversations (alongside the existing editable `created_at`).
- When a previously unset Resolved date is picked, status is auto-flipped to `resolved` in the same write so analytics counts the conversation as closed.
- Clearing the Resolved date reverts status to `active` (slack/manual) or `open` (gmail) and nulls `resolved_at`.
- Both actions are logged to `conversation_audit_logs` as `updated_resolved_at` (old → new, or `(cleared)`).
- This is **local only** — it does not close the upstream Intercom conversation, Gmail thread, or Slack mapping. The popover shows a small note clarifying this.
- `ManualConv` interface in `ConversationDetail.tsx` was extended with `resolved_at: string | null` (the underlying `manual_conversations.resolved_at` column already existed).

## Internal notes — two sources, one rendering

Two independent sources both render as the same yellow "Internal note" card, interleaved chronologically with messages on the conversation detail page. There is no separate "Internal notes" tab; the tabs below the thread are "Reply to customer" and "Activity log".

**1. User-authored notes** — stored in `conversation_notes` (`conversation_id` + `conversation_source` + `author` + `note_text` + `created_at`).
- Created via the inline composer below the thread on `/conversations/:id`. ⌘+Enter submits.
- Hover reveals a delete (X) button.
- Author name is saved to `localStorage` under `note_author` and reused across sessions.
- RLS: authenticated read / insert / delete; no UPDATE.

**2. Intercom-origin notes** — Intercom conversation parts with `part_type === "note"` are ingested into `manual_messages` with `is_internal_note = true` (column added 2026-04). Previously they were filtered out of every Intercom ingestion path.
- Affected ingestion functions: `import-intercom-ticket`, `backfill-intercom-replies`, `poll-intercom-inbox`, `backfill-enterprise-inbox`, `bulk-import-intercom`, `intercom-webhook` (live, including the `conversation.admin.noted` topic in `REPLY_TOPICS`).
- Notes do **not** change the customer-facing status (`awaiting_customer` / `awaiting_support`).
- The webhook still skips notes when forwarding back to Slack via `lastCommentPart` — only `comment` parts and `assignment` parts with non-empty body (Intercom's "assign and reply") are mirrored to customers. `note` and other system part types stay internal.
- Read-only — no UI to delete or post a note back to Intercom.
- `backfill-intercom-replies` dedup key is `epoch:is_internal_note` so a note posted at the same second as a reply isn't suppressed.
- To pull notes into already-imported tickets, run `backfill-intercom-replies?recent=true` (recent 7 days) or paginate with `offset`/`limit` for the full historical set.

---

## Slack import — auto-navigate to triage

After a successful Slack thread import in `ImportTab` (`/import`), the UI extracts `data.conversation.id` from the import response and navigates to `/conversations/:id?source=slack`. This drops the user straight into the triage view for the freshly imported thread instead of leaving them on the import form. Same pattern can be applied to other import paths (Intercom single-URL, bulk) when desired.

---

## `manual_messages` dedup rule (general)

`manual_messages` has no DB-level uniqueness constraint. Any code path that inserts into it MUST first fetch existing rows for the conversation and filter incoming messages by key:

```
${role}|${floor(created_at_ms / 1000)}|${message_text}
```

Drop incoming rows whose key already exists. This is required because (a) Intercom fires both `conversation.admin.assigned` and `conversation.admin.open.assigned` ~1s apart for the same logical event and both reach the auto-import path concurrently, and (b) the reply-reconciliation cron and the live webhook can race on the same part. Currently applied in `intercom-webhook` (auto-import path) and `poll-intercom-inbox`. `backfill-intercom-replies` uses its own `epoch:is_internal_note` epoch-based dedup. Any new ingestion function must follow this pattern.

---

## Owners (canonical list)

Canonical owner options across the UI: **Joel, Kristina, Sam (AI agent), CSM, Eren, Tine.**

- Each non-AI owner gets a dashboard at `/my/<lowercase-name>` rendered by `OwnerDashboard.tsx`.
- Eren is a contractor scoped to **SSO/SCIM** work. Tracked in the unified Inbox like any other owner — filter by `Owner = Eren` (optionally combined with `Product area = SSO` or `SCIM`). No separate tables, page, or analytics path.
- Tine has no email, Slack user ID, or Intercom admin ID recorded yet.
- Known teammate emails live in `src/lib/parseThread.ts` `ADMIN_OPTIONS` (e.g. Eren = `eren@lovable.dev`).

To add a new owner:
1. Append to `OWNER_OPTIONS` in `src/pages/Conversations.tsx` (also extend the `OwnerFilter` type), `src/pages/ConversationDetail.tsx`, and the `SelectItem` list in `src/pages/TestChannelReview.tsx`.
2. Add to `OWNER_MAP` in `src/pages/BulkImportReview.tsx` (lowercase name → display name).
3. Add a sidebar entry in `src/components/AppLayout.tsx` `dashboardItems` (route `/my/<lowercase>` is auto-rendered).
4. For Intercom auto-assignment, add their Intercom admin ID → owner name in Settings → Admin → owner mapping (`settings.admin_owner_map`). Read by `intercom-webhook` and `poll-intercom-inbox`.

---

## Intercom CSAT capture

Intercom's `conversation_rating` (1–5 plus optional `remark`) is captured into `manual_conversations` and `gmail_conversations` via three columns: `csat_rating smallint`, `csat_remark text`, `csat_rated_at timestamptz`. A trigger (`validate_csat_rating`) enforces 1–5 on insert/update.

Capture paths:
- `import-intercom-ticket` and `bulk-import-intercom` set CSAT on insert if Intercom returns a rating.
- `refresh-intercom-csat` edge function pulls ratings for any Intercom-linked conversation that doesn't yet have one. Runs every 6h via pg_cron job `refresh-intercom-csat-6h` against `?mode=recent` (only conversations resolved in the last 14 days). Call with `?mode=backfill` for a one-time historical sweep.
- The `poll-intercom-inbox` and `intercom-webhook` paths intentionally do NOT touch CSAT — ratings arrive minutes-to-days after resolution, so the cron is the source of truth.

Surfaced on `/stats` under "Customer satisfaction" with avg, total, response rate (ratings / resolved Intercom-linked conversations in scope), 1–5 distribution chart, and a click-through list of recent 1–2★ ratings.

## Slack-side CSAT (Sam / Ask Lovable)

`conversation_mappings` also has `csat_rating`, `csat_remark`, `csat_rated_at` plus `csat_prompt_ts`. When `intercom-webhook` resolves a Slack-originated conversation, it posts a second threaded message with five emoji buttons (😠 Terrible / 🙁 Bad / 😐 OK / 😀 Great / 🤩 Amazing, action_ids `csat_1`…`csat_5`) and stores the message ts in `csat_prompt_ts` (idempotent — skipped if already prompted/rated). `slack-interactions` records the rating, replaces the prompt with a thank-you, and opens an optional remark modal (`callback_id: csat_remark_modal`) on the first click. Ratings are merged into the same Stats card and a "Customer satisfaction" card on the conversation detail page.

When the remark modal is submitted, `slack-interactions` surfaces the remark in three places (all wrapped in `EdgeRuntime.waitUntil` so the modal closes immediately):
- Posts `💬 Customer remark on N/5: "..."` back into the original Slack thread via `chat.postMessage` (best-effort).
- Adds an internal note on the linked Intercom conversation via `POST /conversations/{id}/reply` with `message_type: "note"`, `admin_id = settings.intercom_assignee_id`. Skipped silently if `intercom_conversation_id` is missing.
- Renders a synthetic `csat` entry inline in the Conversation Detail message timeline, sorted by `csat_rated_at` (in addition to the existing side card).

## Intercom "assign and reply" parts

Intercom delivers an admin's assign-and-reply text on `part_type === "assignment"`, not `comment`. The `intercom-webhook` part-picker (`FORWARDABLE_PART_TYPES`) therefore accepts both `comment` and `assignment` parts that carry a non-empty body; `note` and other system part types stay excluded so internal content never leaks to Slack. Dedup still flows through `claim_intercom_part` keyed on `part.id`, so the broader filter cannot cause double-posting.

---

## Inline editing of messages and notes

On the conversation detail page, hovering a manual message or internal note (either source: `conversation_notes` row or `manual_messages` with `is_internal_note=true`) reveals a pencil icon. Clicking opens an inline `Textarea` with Save / Cancel; ⌘+Enter saves, Esc cancels. Saves write to `manual_messages.message_text` or `conversation_notes.note_text` respectively. Author / role / timestamp are read-only. RLS: `conversation_notes` now has an authenticated UPDATE policy (added 2026-05).

## "Escalated to human" stat definition

On `/stats`, a Slack conversation counts as escalated if it has a non-empty `intercom_conversation_id` (i.e. was ever handed off to a human in Intercom), in addition to current `status in ('escalated','escalated_pending')`. This avoids zero counts when humans resolve the ticket in Intercom and the status flips to `resolved`. Applies to: Overview KPI, status pie, daily volume bar, and escalation-rate trend.

## Insights page (full)

`/insights` (`src/pages/Insights.tsx`) is the monthly support analytics surface. Month selector covers the current month + 11 prior; default = previous month. Tabs: **Report · Topics · Customers · Ticket types · Trends · Channels**. The Refresh button bumps `reportRefreshKey` to refetch month data; "Generate / Regenerate topics" invokes `analyze-intercom-month` (Lovable AI Gateway) to (re)cluster topics for the month.

### Shared data hook — `src/pages/insights/useMonthData.ts`

Pulls `conversation_mappings`, `gmail_conversations`, and `manual_conversations` for the month with `is_test = false`, normalizing into a single `NormalizedTicket[]` with `route_source` (origin: slack/gmail/manual) and `display_source` (intercom/slack/gmail/other) on every ticket.

- Gmail rows are deduped by `gmail_thread_id` (earliest row wins).
- Manual rows whose `intercom_conversation_id` already exists in `conversation_mappings` are dropped to avoid double-counting Slack-escalated tickets that were also imported manually.
- `accountFromEmail` collapses free-mail domains (`gmail.com`, `outlook.com`, …) into a single `Personal email` aggregate via the `PERSONAL_DOMAINS` set. Slack manual imports try to extract a channel ID from the `link` URL via `extractSlackChannelId`.

### Source attribution rule — `src/pages/insights/sourceBucket.ts`

Single source of truth used by Source mix and Source performance. Origin always wins — a Slack-originated conversation later escalated to Intercom still counts as **Slack**.

```ts
sourceBucketOf(t):
  route_source === "slack"      → "slack"
  route_source === "gmail"      → "gmail"
  display_source === "intercom" → "intercom"   // manual imports flagged Intercom
  else                          → "other"
```

Invariant: `Slack + Gmail + Intercom + Other = Total tickets` for the month.

### Report tab — `ReportTab.tsx` + `MonthStatsCards.tsx`

- Headline stats: total tickets (with delta vs previous month), median time-to-resolve, resolved %, classification mix, average CSAT, peak day-of-week.
- Source mix donut and **Top accounts** (Slack channels and Gmail+Intercom domains, top 5 each, `lovable.dev` and `Personal email` aggregate excluded from the email column only).
- **Source performance** table (see next subsection).
- Highlights bullets, product-area bar chart, owner load table, classification mix.
- Owner load rows deep-link to `/conversations` with owner/month filters, `showAll=1`, and a clean drilldown state: source/product/classification/search filters are ignored, status hiding is disabled, test rows are excluded, and Gmail threads use the same earliest-created representative row as `useMonthData` so the visible rows reconcile with the report count.
- `UncategorizedPanel` lists tickets missing classification or product area for triage.
- **PDF export**: `jsPDF` + `html2canvas` snapshot of `reportRef`, multi-page A4, filename `insights-{month}.pdf`.
- **AI narrative**: pulls the saved `monthly_insights` row (`source = "all"`, falls back to legacy `source = "intercom"`) and renders `overall_summary`.

### Source performance table (`MonthStatsCards.tsx`)

Single comparison table, rows = metrics, columns = Slack / Gmail / Intercom.

- **Counts** (Received, Resolved, Open, Escalated to human, Median resolution / time to close, Average resolution, Success rate, Bot success rate) come from the **local DB** via `data.tickets` bucketed with `sourceBucketOf` — guarantees reconciliation with `Total`.
- **Slack-only rows**: `Escalated to human` (tickets with `intercom_conversation_id` set or `status in ('escalated','escalated_pending')`) and `Bot success rate` (resolved without Intercom / total Slack).
- **Intercom timing rows** (`Median first response`, `Median response time`, `Median handling time`) are fetched live from the Intercom API via the `intercom-month-stats` edge function — local data lacks admin-side reply timestamps.
- Footer: counts are local DB (matches Total); response & handling times are live from Intercom API, with current vs previous month conversation counts.
- **Why not Intercom's live count for the Intercom column**: it includes Slack-escalated conversations (already counted under Slack) and conversations never imported locally — using it as the headline would double-count and break the invariant. Shown only in the footer for context.

### Topics tab (rendered inline in `Insights.tsx`)

Reads from the `monthly_insights` table (`month`, `source`, `buckets`, `overall_summary`, `product_area_summary`, `ticket_count`, `generated_at`). Renders topic-bucket cards with source breakdown, product area badges, and example subjects; click opens a Sheet listing all tickets in the bucket with deep-links to `/conversations/:id`. Generation/regeneration calls `analyze-intercom-month`.

### Customers tab — `CustomersTab.tsx`

Aggregates by Slack channel and email domain (Gmail + Intercom combined, `lovable.dev` and `Personal email` excluded). Resolves Slack channel names via `list-slack-channels` (conversations.list → conversations.info → connector gateway fallback). Top 5 each with bug/FR counts and CSAT.

### Ticket types tab — `TicketTypesTab.tsx`

Buckets tickets by the full `classification` taxonomy used in `Conversations`/`ConversationDetail`: `Issue`, `Configuration`, `Bug`, `FR`, `Question`, plus `Unclassified`. Legacy fallback: if `classification` is empty but `is_bug` or `is_feature_request` is true, the ticket falls into `Bug` or `FR`. KPI cards, avg time-to-resolve per type, type-mix-by-product-area, and owner load all use this 6-bucket model with consistent color tokens. There is no "Incident" classification — incident.io detection is a Slack-only status helper and is not stored on tickets.

### Trends tab — `TrendsTab.tsx`

Multi-month series (volume, median TTR, escalation rate, CSAT) by sequentially calling `useMonthData` for prior months.

### Channels tab — `ChannelsTab.tsx`

Slack-channel-only breakdown of volume, classification mix, and product area split.

### Edge functions

- **`analyze-intercom-month`** — re-clusters the month's tickets via Lovable AI Gateway and upserts the `monthly_insights` row (`source = "all"`).
- **`intercom-month-stats`** — queries Intercom Conversations Search for the configured enterprise inbox and returns medians of `time_to_admin_reply`, `median_time_to_reply`, and `time_to_last_close` (seconds) plus a `count` for both the selected and previous month. Used only by the Intercom timing rows of Source performance. Auth: `INTERCOM_API_TOKEN`. No DB writes.
- **`audit-intercom-month`** — audit helper that predates the recent Source-performance changes.

### `monthly_insights` table

Keyed by (`month`, `source`); columns include `buckets jsonb`, `overall_summary text`, `product_area_summary jsonb`, `ticket_count int`, `generated_at timestamptz`. Old rows used `source = "intercom"`; new generations use `source = "all"` (covers Slack + Gmail + Intercom + manual). The Topics tab loader prefers `"all"` and falls back to `"intercom"`.

### Manual contact normalisation — `src/pages/insights/manualAccounts.ts`

Free-text `manual_conversations.contact_name` is normalised into a stable account key via `normalizeManualContact()` for Top accounts aggregation. Order: (1) email-in-name → domain bucket via `accountFromEmail`; (2) alias map (e.g., `McKinsey`, `Sergey Gorchichko-WROC`, `pulkit_agarwal@mckinsey.com` → `account:mckinsey`); (3) fallback `contact:<lowercased name>`. Internal lovable.dev contacts map to `account:lovable_internal` and are filtered out by `INTERNAL_MANUAL_KEYS` (mirrors the existing Top accounts filter). The Insights → Report "Top accounts" card has a third `Manual contacts` mini-table fed by `stats.manualAccounts`. Extend `ALIAS_MAP` as new accounts surface.

### Integration health surfacing — `integration_health` table + `_shared/integration-health.ts`

`public.integration_health` (PK = `integration` key) stores the last success/failure per backend integration. Authenticated users read it; only edge functions (service role) write to it. Shared helper `recordIntegrationHealth(sb, key, status, error?)` upserts a row with `last_success_at`/`last_failure_at`, `last_status` (`ok`/`auth_error`/`error`), `last_error`, and `consecutive_failures`. `auth_error` is mapped from HTTP 401/403 via `classifyHttpStatus`.

Wired into: `poll-intercom-inbox` (search 4xx + on success), `intercom-webhook` (auto-import fetch failure + success), `refresh-intercom-csat` (aggregated per run; auth_error only if every fetch was 401/403), `import-intercom-ticket` (per call), `poll-gmail` (success + error categorised by `PollErrorCategory`: oauth/token/scope → auth_error, else error).

**Run-level aggregation in `poll-intercom-inbox`**: the function loops through one team-assignee query plus N admin-assignee queries. Each failed search records an `auth_error`/`error` mid-run, but the function only writes `intercom_poll = "ok"` at the end of the run if `upstreamFailed` stayed false. If any query failed, the final write re-stamps the last `auth_error`/`error` so it sticks. Without this, a fully 401'd run (e.g. expired `INTERCOM_API_TOKEN`) would still surface as Healthy because the trailing `"ok"` upsert reset `consecutive_failures` to 0. The same pattern should be used for any future poller that fans out multiple upstream calls per invocation.

UI: `src/components/IntegrationHealthCard.tsx` is mounted at the top of Settings. It polls `integration_health` every 60s and renders a badge per integration — Healthy / Stale (last success older than per-integration `maxStaleMin`) / Auth error / Failing. A stale Intercom/Gmail badge is the user's signal that the API token needs to be re-pasted. The card header also has a **Send test alert** button that invokes `integration-health-alert` with `{ test: true }` and surfaces Slack errors (e.g. `not_in_channel`) as a toast so the Slack wiring can be verified without waiting for a real failure.

### Slack alerting for integration health — `integration-health-alert` edge function

Runs every 10 minutes via `pg_cron` (`integration-health-alert-every-10min`). For each row in `integration_health` it computes a severity (`ok` / `warn` / `auth` / `error`) using per-integration freshness windows (Intercom poll 30min, Gmail 30min, Intercom CSAT 3min, Intercom import 1440min) plus `last_status`. Non-ok severities are posted to `#enterprise-support-hub-alerts` via Slack `chat.postMessage` using `SLACK_BOT_TOKEN` (the same Ask Lovable bot used elsewhere — it must be `/invite`d to the alerts channel or posts fail with `not_in_channel`). Recoveries (severity transitioning back to `ok`) post a ✅ message.

De-duplication: `integration_health.last_alerted_status` + `last_alerted_at` track the most recent posted severity per integration. The same severity is re-posted at most every 6 hours; a severity change always posts immediately. Passing `{ test: true }` (or `?test=1`) short-circuits the loop and posts a single `:satellite_antenna: *Test alert*` message — used by the Settings button.

### Cross-thread link conflict alerts — `intercom-webhook` `postGuardAlert`

When the inverse-uniqueness guard (Option 2) refuses to stamp a second Gmail thread on an Intercom ticket that is already linked to a different thread, `postGuardAlert()` posts a `:shield: Cross-thread link blocked` message to `#enterprise-support-hub-alerts` (channel ID `C0B9NSBM60H`) using `SLACK_BOT_TOKEN` with `username: "Support Hub Guard"` / `icon_emoji: ":shield:"` (same bot as Support Hub Health, just a per-message identity override). Two call sites mirror the two guard log lines: `[cross_thread_link_conflict:email]` and `[cross_thread_link_conflict:subject]`. The post is non-blocking — failures are caught and logged so the guard always returns. Expected volume is ~0.7 alerts/day based on historical conflict rate (see chat history Jun 10).

### Inbox v2 sandbox — `/inbox-v2`

Parallel page that mirrors Intercom directly into a new `inbox_v2_tickets` table. Built as a no-blast-radius sandbox so we can validate that Owner / Product Area / Classification pulled from Intercom match what we actually want to show in the live Inbox before we cut over.

- Table `public.inbox_v2_tickets` keyed by `intercom_conversation_id` (unique). Stores Intercom-sourced `owner` (via `admin_owner_map`), `product_area` (custom_attributes["Affected Product Area"]), `classification` (custom_attributes["Ticket type"]), `status`, contact info, timestamps, and the full `raw_payload` jsonb for debugging. RLS: authenticated read-only; only the sync function (service_role) writes.
- Edge function `sync-inbox-v2` searches the enterprise inbox for conversations updated within `windowHours` (default 24), fetches each full conversation, and upserts. Unlike the live tables it intentionally nulls-out values when Intercom is blank — drift is the signal we want.
- Two pg_cron jobs: `sync-inbox-v2-frequent` every 15 minutes (windowHours=2) and `sync-inbox-v2-nightly` at 03:00 UTC (windowHours=720).
- UI `src/pages/InboxV2.tsx`: read-only table with search + filters (Owner / Product Area / Classification / Status, each with a "missing" option), a "Sync now" button that invokes the function on demand, and a right-side drawer with a "View in Intercom" link.
- No existing table, function, cron, query, or page is touched. Cutover (pointing the live Inbox / `/my/*` at this data) is a future step.

### Changelog page — `/changelog`

Self-service release notes shown in the app. Backed by `public.changelog_entries` (id, entry_date, title, body, tags `text[]`, area, author_user_id). Tags are one of `new` / `improved` / `fixed` / `internal` and drive the badge color. RLS allows any authenticated user to read, insert, update, and delete entries — same trust model as Settings and Knowledge. Updated_at is maintained by the shared `update_updated_at_column` trigger.

UI: `src/pages/Changelog.tsx` lists entries reverse-chronologically, grouped by month with a sticky month header. `src/components/changelog/AddEntryDialog.tsx` is the add/edit dialog (date, title, body, tag multi-select, optional area). Each entry has inline edit/delete controls. Sidebar entry sits below Knowledge in the bottom utility section, icon `ScrollText`.

Out of scope: no public/marketing feed, no RSS, no auto-generation from git/edit history, no Slack/email broadcast on new entries. Add entries manually whenever something user-visible ships.
