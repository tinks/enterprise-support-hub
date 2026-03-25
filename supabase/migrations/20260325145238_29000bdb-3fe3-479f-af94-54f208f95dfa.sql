UPDATE knowledge_documents SET pending_content = '# Project Knowledge — Slack ↔ Intercom Support Bridge

> **Last updated:** 2026-03-25
> This document captures all rules, logic, and behaviors of the system. Update it whenever logic changes.

---

## 1. Overview

A Slack-to-Intercom support bridge for enterprise customers. When a user @mentions the bot in Slack, it creates an Intercom conversation assigned to an AI agent ("Sam"), relays responses back to Slack with feedback buttons, and supports escalation to human agents. The system has a dashboard UI for configuration, conversations monitoring, flow visualization, and statistics.

---

## 2. Architecture

### Edge Functions
| Function | Purpose |
|---|---|
| `slack-events` | Handles Slack `app_mention`, direct messages (`message.im`), and thread reply events |
| `slack-interactions` | Handles Slack button clicks, modal submissions, and feedback actions. Also contains the proactive polling logic for Sam''s initial reply |
| `intercom-webhook` | Receives Intercom webhook events (admin replies, conversation/ticket closed) and relays to Slack |
| `check-bot-identity` | Diagnostic endpoint — verifies the Slack bot token identity against expected bot user ID |
| `list-slack-channels` | Lists Slack channels for the settings UI channel browser |
| `list-slack-users` | Lists Slack users (utility) |

### Database Tables
| Table | Purpose |
|---|---|
| `settings` | Singleton config: monitored channels, Intercom IDs, testing mode, bot user ID |
| `conversation_mappings` | Maps Slack threads ↔ Intercom conversations with status tracking |
| `bot_messages` | Editable bot message templates (keyed by `message_key`) |
| `flow_node_positions` | Persisted drag positions for the flow diagram UI |
| `knowledge_documents` | Stores project knowledge content and pending agent-proposed changes |

### UI Pages
| Route | Page | Purpose |
|---|---|---|
| `/` | Stats | System statistics and analytics dashboard |
| `/settings` | Settings (Index) | Configure channels, Intercom IDs, testing mode, view webhook URLs |
| `/conversations` | Conversations | View and monitor active/resolved conversations |
| `/flow` | Flow Diagram | Interactive visual diagram of the full support workflow |
| `/knowledge` | Project Knowledge | View, edit, and review the project knowledge document |

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
       ↓                                ↓
   cancelled                        escalated ⇄ escalated_pending → resolved
```

| Status | Meaning |
|---|---|
| `awaiting_context` | Bot posted context prompt, waiting for user to click "Add Details", "Proceed", or "Cancel" |
| `processing` | User clicked a button, ticket creation in progress |
| `active` | Intercom conversation created, AI agent handling |
| `active_pending` | User sent a thread reply while active, waiting for Sam''s response |
| `escalated` | User clicked 👎 or Sam auto-escalated |
| `escalated_pending` | User sent a thread reply while escalated, waiting for human response |
| `resolved` | User clicked 👍 or conversation/ticket closed in Intercom |
| `cancelled` | User clicked "Cancel" — request dismissed without creating an Intercom ticket. Excluded from stats |

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

### Step 1: User @mentions bot or sends a DM
- **Function:** `slack-events`
- Verifies Slack signature
- Handles both `app_mention` events and direct messages (`channel_type === "im"`) from workspace members
- DMs use the same flow as @mentions — the DM message itself becomes the thread root
- Auto-adds new channels to `monitored_channels` on first @mention (no manual setup needed)
- Atomic INSERT with `ON CONFLICT DO NOTHING` prevents race from Slack retries
- If thread reply → fetches full transcript via `conversations.replies`
- Collects file attachments from thread

### Step 2: Bot posts context prompt
- **Function:** `slack-events`
- Posts a Block Kit message with three buttons: "Add Details" (primary), "Proceed", and "Cancel"
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
- **Error recovery:** If ticket creation fails during `view_submission` or `view_closed`, the handler resets status back to `awaiting_context` and restores the original prompt with all three buttons, preventing the "Gathering your details…" freeze

### Step 3b: "Proceed" clicked
- **Function:** `slack-interactions`
- Skips modal, creates ticket with original message only
- Updates prompt message to ack text via `chat.update`

### Step 3c: "Cancel" clicked
- **Function:** `slack-interactions`
- Atomic guard: updates status to `cancelled` only if currently `awaiting_context`
- Updates prompt message via `chat.update` to show cancellation acknowledgment (key: `request_cancelled`)
- No Intercom ticket is created
- No reactions added
- Conversation is excluded from all stats

### Step 4: Intercom ticket created
- **Function:** `slack-interactions` → `createIntercomTicket()`
- Adds 👀 reaction to original message
- Searches/creates Intercom contact (handles 409 Conflict by extracting existing contact ID from error message via regex)
- Downloads & re-hosts file attachments to Supabase Storage (`public-assets/slack-attachments/`)
- Prepends anti-escalation internal note to conversation body (key: `internal_note`)
- Creates conversation with text + attachment URLs
- Assigns to AI agent (from `settings.intercom_assignee_id`)
- Sets custom attributes: `Slack channel`, `source: Slack`, `support_tier` (see Section 16)
- Sends group DM notification to hardcoded user IDs (Kristina & Joel)
- If testing mode → posts debug message with Intercom conversation ID

### Step 5: AI responds → posted to Slack
- **Primary path:** Proactive polling in `slack-interactions` at 10s/20s/30s/60s intervals after ticket creation
- **Fallback path:** `intercom-webhook` for subsequent replies
- **Internal note filtering:** Both paths skip `part_type === "note"` to prevent interim messages (e.g., "Sam is working…") from leaking to Slack
- **Deduplication:** Postgres RPC `claim_intercom_part` with row-level locking (`SELECT ... FOR UPDATE`) — first caller wins
- Removes old feedback buttons from thread before posting new reply
- Converts HTML to Slack markdown (br→\n, p→\n\n, li→bullet, strips tags)
- Strips AI footers/sign-offs
- Splits messages at 2500 chars / 35 lines to avoid Slack''s "See more" collapse
- Posts reply with divider + timestamp header + author attribution
- Forwards Intercom attachments + inline images (deduped) to Slack
- **Incident.io detection:** If reply references incident.io/status page → fetches live status from `status.lovable.dev` and posts status block with subscribe button; includes escalate button if not already escalated
- **Interim message detection:** Pattern matches "Sam is working/thinking/typing..." → no buttons posted
- **Auto-escalation detection:** Regex matches escalation keywords → hides feedback buttons, posts routing notice, sets status to `escalated`, swaps reactions (eyes→hourglass), converts conversation to ticket (ticket_type_id: "1")
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
  - Overrides Slack message identity with admin''s name and avatar
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
| `reply_forwarded` | Step 6b-i | Message when user''s Slack reply is forwarded |
| `conversation_closed` | Step 7 | Message when conversation is closed from Intercom |
| `context_reminder` | Step 2 (cron) | Reminder posted after 15 min if user hasn''t interacted with context prompt |
| `internal_note` | Step 4 | Anti-escalation context prepended to Intercom conversation body (not shown to user) |
| `request_cancelled` | Step 3c | Message shown when user cancels their support request |

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
| Intercom part dedup (webhook) | `intercom-webhook` | Postgres RPC `claim_intercom_part` with `SELECT ... FOR UPDATE` row locking — guarantees exactly one winner |
| Intercom part dedup (polling) | `slack-interactions` | Same `claim_intercom_part` RPC call |
| Status transition guards | All functions | UPDATE with `eq("status", expectedStatus)` — second writer gets empty result |

---

## 11. Configuration (Settings Table)

| Field | Purpose |
|---|---|
| `monitored_channels` | Comma-separated Slack channel IDs (auto-expanded on first @mention) |
| `intercom_inbox_id` | Team inbox ID for human escalation reassignment |
| `intercom_assignee_id` | AI agent ID (Sam) for initial assignment + conversation close operations |
| `slack_bot_user_id` | Expected bot user ID for identity guard verification |
| `testing_mode` | When true, posts Intercom conversation IDs in Slack for debugging |
| `test_intercom_inbox_id` | Intercom inbox ID for test conversations (default: `10219738` — "Slack Test" inbox) |

---

## 12. Channel name overrides

`src/lib/channelOverrides.ts` provides a manual mapping of Slack channel IDs to display names. This is used by the Conversations and Stats pages to show readable names for private channels that the Slack API cannot resolve (the bot must be a member to look up channel info).

---

## 13. Required Secrets (Edge Function Environment)

| Secret | Used By |
|---|---|
| `SLACK_BOT_TOKEN` | All Slack-facing functions |
| `SLACK_SIGNING_SECRET` | `slack-events`, `slack-interactions` |
| `INTERCOM_API_TOKEN` | `slack-events`, `slack-interactions`, `intercom-webhook` |
| `INTERCOM_WEBHOOK_SECRET` | `intercom-webhook` |

---

## 14. Incident.io / Status Page Integration

- Triggered when Sam''s reply contains keywords: `incident.io`, `status.lovable.dev`, `we have an incident`, `status page`
- Fetches live status from `https://status.lovable.dev/api/v2/summary.json`
- Posts a formatted status block with component statuses and emoji indicators
- Includes "Subscribe to status updates" button linking to status page
- Replaces `[App: incident.io]` references with actual status page URL

---

## 15. Auto-Escalation (Sam → Human)

Sam''s replies are scanned for escalation keywords:
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

## 15b. Context Reminder & Auto-Proceed

A cron function (`context-reminder`) runs every 5 minutes and checks for conversations stuck in `awaiting_context`:

- **15 minutes:** Posts a reminder in the Slack thread nudging the user to click "Add Details" or "Proceed"
- **30 minutes:** Automatically creates the Intercom ticket (same as clicking "Proceed") — looks up user email, creates contact + conversation, assigns to Sam

Dedup: `reminder_sent_at` prevents duplicate reminders; atomic status guard prevents double ticket creation. The `prompt_message_ts` column stores the bot''s prompt message timestamp so it can be updated via `chat.update`.

---

## 16. Test isolation & Lovable employee detection

### Automatic employee detection
- When a new conversation is claimed in `slack-events`, the bot looks up the Slack user''s email via `users.info`
- If the email ends with `@lovable.dev`, the conversation is automatically marked `is_test: true` in `conversation_mappings`, regardless of the `testing_mode` toggle
- This applies to both @mention and DM handlers

### Test inbox routing
- All edge functions that assign or reassign Intercom conversations check the `is_test` flag on the mapping
- If `is_test` is true, conversations are routed to `settings.test_intercom_inbox_id` instead of `settings.intercom_inbox_id`
- This applies in: `slack-interactions` (ticket creation, escalation), `context-reminder` (auto-proceed), `intercom-webhook` (escalation reassignment)
- Routing logic: `const inboxId = mapping.is_test ? settings.test_intercom_inbox_id : settings.intercom_inbox_id`

### Intercom tagging
- Test conversations (`is_test: true`) are tagged with custom attribute `support_tier: "Test"` instead of `"Enterprise Support"`
- This allows filtering test conversations out of Intercom reporting and views
- The internal dashboard already separates test/production data via the existing environment filter on the Stats page

---

## 17. Group DM Notifications

- On every ticket creation, a group DM is sent to hardcoded Slack user IDs: `U0AFU714807` (Kristina) and `U091GANMA2U` (Joel)
- Contains links to both the Slack thread and the Intercom conversation

---

## 18. Intercom API version

All Intercom API calls use `Intercom-Version: 2.11`.

---

## 19. Flow Diagram (UI)

- Interactive React Flow diagram showing the complete support workflow
- Nodes are draggable; positions are persisted to `flow_node_positions` table
- Bot message nodes are editable inline — changes save to `bot_messages` table and take effect immediately
- Supports PNG export via `html-to-image`
- **Rule:** Whenever logic changes are made, the Flow Diagram must be updated to stay in sync

---

## 20. Project Knowledge Document

- Stored in `knowledge_documents` table with columns: `content` (current approved), `pending_content` (proposed changes), `pending_summary` (change description)
- **CRITICAL RULE:** The AI agent must NEVER directly update the `content` column. Instead, it must write proposed changes to `pending_content` and a brief summary to `pending_summary`. The user reviews the diff in the Knowledge tab and clicks "Approve" or "Reject".
- The Knowledge page (`/knowledge`) shows a rendered markdown preview, an edit mode for manual edits, and a diff-based review mode for pending agent changes
- Manual edits by the user via the Edit mode save directly (no approval needed)
- Pending changes are highlighted with an orange banner across the UI
- The diff view uses LCS-based line comparison showing added (green) and removed (red) lines

### Agent Workflow for Updating Knowledge
1. Read current content: `SELECT content FROM knowledge_documents WHERE id = ''project-knowledge''`
2. Write proposed changes: `UPDATE knowledge_documents SET pending_content = ''...'', pending_summary = ''...'', pending_at = now() WHERE id = ''project-knowledge''`
3. Inform the user that changes are pending review in the Knowledge tab
4. **DO NOT** update the `content` column directly' WHERE id = 'project-knowledge';