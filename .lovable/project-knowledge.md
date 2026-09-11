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
| `poll-slack-closed-won` | Daily cron (04:00 UTC): reads the last 7 days of messages from Slack channel `C09CL5E028N` via the "11 - PICK THIS BOT CONNECTION" bot (`SLACK_API_KEY_1`), extracts `Company Name:` / `Company Domain:` lines, and inserts new rows into `v3_customer_accounts` (dedupe by `domains` + `account_key`). Malformed domains are rejected and reported; every run records `integration_health.slack_closed_won_poll` |
| `poll-slack-incidents` | Reads incident.io announcements from Slack channel `C07TMQ5E6SC` (#incidents) and upserts `public.incidents` by incident number. Scheduled every 15 min by pg_cron job `poll_slack_incidents_15min` (rolling window; `{"full": true}` rescans the whole channel). Customer impact = presence of a public `statuspage.incident.io` link. Records `integration_health.slack_incidents_poll` |
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

### Roles & permissions
- Enum `public.app_role` (`admin`, `user`) + table `public.user_roles (user_id, role)` (unique per pair)
- Security-definer function `public.has_role(uuid, app_role)` is the ONLY approved way to check roles in RLS — never query `user_roles` directly from a policy on `user_roles` (recursion)
- `user_roles` RLS: users read their own rows; admins read all; only admins insert/update/delete
- `BEFORE DELETE` trigger `user_roles_prevent_last_admin_delete` blocks removing the final admin row
- Admin-only RPC `public.list_users_with_roles()` returns every `auth.users` row + their roles; raises if caller isn't admin (keeps `auth.users` off the client)
- Client hook `useIsAdmin()` (`src/hooks/useIsAdmin.ts`) gates UI only — server enforcement is always RLS + `has_role()`
- Managed from the single **Admin → Users** table (`src/components/UsersCard.tsx`); non-admins don't see it. `AccessCard` + `RolesCard` were merged into it on 17 Aug 2026 and both files deleted
- First admin: `matt.niiro@lovable.dev`
- All future admin-gated tables MUST use `public.has_role(auth.uid(), 'admin')` in policies rather than reimplementing the check

### Edge-function caller gates (Batch B, 2 Sep 2026)

Three gates, chosen per function by *who legitimately calls it*:

| Gate | Helper | Applies to |
|---|---|---|
| `requireUser` | `_shared/require-user.ts` | read-only, UI-invoked (7 read fns + `sla-ticket-analyze`) |
| `requireEditor` | `_shared/require-editor.ts` | UI-only mutations (17 functions) |
| `requireEditorOrSecret` | `_shared/require-editor-or-secret.ts` | cron **and** UI (17 functions) |

`requireEditorOrSecret` accepts exactly three callers and 401s everything else:
1. header `x-esh-cron-secret` matching `public.cron_auth.secret` (constant-time compare, 5-min in-isolate cache)
2. `Authorization: Bearer <service-role key>` — internal function-to-function invokes (`sync-v3-gap-scan` → `sync-v3-closed`)
3. a signed-in editor/admin session (falls through to `requireEditor`)

**The cron secret is never written into a job definition.** `public.cron_auth` (one row) holds it; `public.esh_cron_headers()` (SECURITY DEFINER, service-role only) returns `{Content-Type, x-esh-cron-secret}` and is called *at fire time* inside each `net.http_post`. Migration `0030_cron_auth_secret`.

**Explicit deny-all on the two internal tables** (migration `0037`, 9 Sep 2026): `public.cron_auth` and `public.gmail_oauth_states` each carry a `RESTRICTIVE ... FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)` policy, plus a table comment stating they are service-role only. **Correction to earlier text:** both tables *do* hold full `arwdDxtm` grants for `anon` and `authenticated` (`pg_class.relacl` verified) — the only thing blocking those roles before this migration was RLS-on-with-zero-policies, i.e. default deny. That is real but fragile: a single permissive policy added later would have opened the table. The restrictive policy makes the denial unconditional, since a restrictive policy can never be widened by a permissive one. Service-role access (every edge function, `esh_cron_headers()`) is unaffected — it bypasses RLS. Linter findings went 32 → 30 (the `rls_enabled_no_policy` category cleared). **Parked deliberately:** revoking the redundant `anon`/`authenticated` grants, moving `pg_trgm` out of `public`, and the 29 `authenticated`-executable SECURITY DEFINER functions.

Before this, every scheduled job sent the publishable anon JWT — indistinguishable from any anonymous caller on the internet. All 20 remaining edge-function cron jobs were re-registered onto `esh_cron_headers()`; the two retired Inbox V2 jobs were unscheduled rather than migrated.

**Deliberately outside these gates:** `slack-events`, `slack-interactions`, `intercom-webhook` (HMAC signature verification is their protection) and `gmail-oauth-callback` (single-use `state` nonce, see below).

**Gmail OAuth state binding** (migration `0029`): `gmail-auth-url` requires an editor and mints a single-use nonce into `public.gmail_oauth_states`; `gmail-oauth-callback` rejects a state that is missing / unknown / already consumed / older than 10 min **before** it deletes and replaces `gmail_oauth_tokens`. The Settings connection indicator reads `public.gmail_connection_status()` rather than the token table.

**Status.** Negative: anonymous and bogus-secret POSTs 401 on 10 sampled functions; all five Gmail state failure modes rejected. Positive: `net.http_post` with `esh_cron_headers()` → 200; post-rewrite scheduled runs healthy (`consecutive_failures = 0` on every `integration_health` row) and a `cron.job` audit shows `uses_secret = true` / `still_has_anon = false` for all 20 jobs. UNVERIFIED: daily-only jobs have not yet fired under the new header; the real Google OAuth round-trip; signed-in editor "Run now" buttons on the newly gated functions.

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
- **Author-type guard (Aug 2026):** after selecting the last forwardable part (`comment`/`assignment` with a body), `intercom-webhook` returns early without relaying when that part's `author.type` is `user`, `lead`, or `contact`. Slack→Intercom forwards of the original requester's own words are posted as user-type parts (no `[From: … via Slack]` prefix on that branch), which Intercom re-emits as `conversation.user.replied`; the relay previously picked them up and echoed the customer's own message back into the Slack thread under the Ask Lovable identity ("parroting" bug, observed on conversation `215475518887389`). Known tradeoff: genuine customer **email** replies on Slack-mapped conversations no longer surface in the Slack thread. A part-ledger approach (record Hub-created part IDs and skip only those) is the future refinement if that tradeoff bites
- Converts HTML to Slack markdown (br→\n, p→\n\n, li→bullet, strips tags)
- Strips AI footers/sign-offs
- Splits messages at 2500 chars / 35 lines to avoid Slack's "See more" collapse
- Posts reply with divider + timestamp header + author attribution
- Forwards Intercom attachments + inline images (deduped) to Slack
- **Incident.io detection:** If reply references incident.io/status page → fetches live status from `status.lovable.dev` and posts status block with subscribe button; includes escalate button if not already escalated
- **Interim message detection:** Pattern matches "Sam is working/thinking/typing..." → no buttons posted
- **Auto-escalation detection:** Regex matches escalation keywords only on Sam/admin AI replies → hides feedback buttons, posts routing notice, sets status to `escalated`, swaps reactions (eyes→hourglass), reassigns to the enterprise team inbox. **Does NOT convert the conversation to an Intercom Ticket** — the convert call was removed 2026-09-01 from all three sites (`slack-interactions` poll path, `slack-interactions` 👎 path, `intercom-webhook` path); reassignment is the escalation marker and everything the Hub touches stays a Conversation. Intercom has no un-convert, so the 44 conversations converted before that date stay Tickets: every ticket-aware read path (`isTicketPayload` / `isFinalizedTicketState` / `isClosedLike` in `_shared/v3.ts`, the `ticket.state ∈ {resolved, archived}` finalize branch in `sync-v3-open`, the ticket handling in `_shared/v3-finalize.ts`, the `ticket.state.updated` topic in `intercom-webhook`) is retained as legacy-only and stops accruing new cases. `conversation_mappings.intercom_ticket_id` is no longer written; the 43 historical values remain readable as a rollback path.
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
- Does **not** convert the conversation to an Intercom Ticket (removed 2026-09-01) — the reassignment above is the escalation marker; the issue stays a Conversation and therefore closes with `state="closed"` and finalizes through the normal `sync-v3-closed` path
- Posts escalation notice (key: `escalation_notice`)

### Slack event handling shape (rewritten 2026-09-10)
`slack-events` used to run the entire workload inline and only respond at the end, which produced 504s (Slack requires an ack within 3s) and retry-driven duplicate processing. The handler is now:
1. Verify the Slack signature (synchronous; 401 on failure).
2. Answer `url_verification` challenges synchronously.
3. Claim the event in `slack_event_claims` — an already-claimed event returns 200 immediately and does nothing else.
4. Return 200.
5. Run all previous logic (mention, DM, thread reply, attachments, Intercom forwarding, cosmetics) inside `EdgeRuntime.waitUntil()`, unchanged.
6. On success mark the claim `done`; on throw write a row to `slack_event_failures` (event id, type, channel, error, full payload) and mark the claim `failed`.

Because Slack no longer retries work that fails after the ack, `slack_event_failures` is the replacement safety net — a payload stored there can be replayed. Also fixed in the same pass: the app-mention and DM `users.info` lookups referenced an undefined `slackBotToken` variable (ReferenceError) instead of `SLACK_BOT_TOKEN`.

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
| Slack event claim (2026-09-10) | `slack-events` | Every valid `event_callback` is claimed in `slack_event_claims` (PK `event_id`, fallback `channel:ts`) with an `ON CONFLICT DO NOTHING` upsert BEFORE the 200 ack. A duplicate/retried delivery logs `[DEDUP]` and returns 200 without re-running any work |
| Intercom part dedup (webhook) | `intercom-webhook` | Atomic UPDATE on `last_intercom_part_id` with conditional WHERE |
| Intercom part dedup (polling) | `slack-interactions` | Same atomic UPDATE pattern, `last_intercom_part_id` guard |
| Status transition guards | All functions | UPDATE with `eq("status", expectedStatus)` — second writer gets empty result |
| Intercom→Gmail subject tier | `intercom-webhook` | Normalizes Intercom ticket subject (strip `Re:`/`Fwd:`/`Fw:`, lowercase, collapse whitespace) and scans `gmail_conversations` from the last 14 days. Runs TWO checks in one pass: (a) **already-represented**: if any matched row has a non-null `intercom_conversation_id` different from the incoming one, log `subject_match_existing_gmail` and return early — skip stamping AND skip manual creation; (b) **stamp**: only if (a) found nothing, look at unlinked candidates and stamp if exactly one distinct thread matches. 0 or >1 distinct unlinked threads → log `subject_link_ambiguous` and fall through |
| Linker priority order (auto-import) | `intercom-webhook` | 1) email→Gmail thread, 2) subject→Gmail tier (14d, with already-represented check + stamp check), 3) subject→`manual_conversations` (7d) — exactly-one match logs `subject_match_existing_manual` and returns without creating a new manual row, 4) create new manual row. Critical: tier 2's "already-represented" check runs even when there's no unlinked thread to stamp — this prevents Google-Group duplicate Intercom tickets from creating duplicate manual rows when the original is in `gmail_conversations` |
| Thread-overwrite guards | `intercom-webhook` | Both Gmail linkers (email + subject stamp) check siblings on the target `gmail_thread_id`. If any sibling already has a non-null `intercom_conversation_id` that differs from the incoming ticket, log `email_link_conflict` / `subject_link_conflict` and return without overwriting. The thread-level UPDATE also uses `.or("intercom_conversation_id.is.null,intercom_conversation_id.eq.<newId>")` as defense-in-depth. The new Intercom ticket is treated as a duplicate; our DB already represents the conversation correctly |
| Reply reconciliation cron | `pg_cron` → `backfill-intercom-replies?recent=true` | Runs every 5 min as a safety net for any Intercom reply webhooks that get dropped, raced, or arrive on topics outside the whitelist. Targets `manual_conversations` and `gmail_conversations` with non-null `intercom_conversation_id` updated/received in the last 7 days, capped at 200 rows. Inserts missing `manual_messages` and resolves status mismatches |
| Database load controls (2026-09-02) | `backfill-intercom-replies` + `_shared/integration-health.ts` + `_shared/settings-cache.ts` | Three fixes for runaway query volume. (1) **Batched dedup prefetch**: the reply reconciliation loop used to issue one `manual_messages` lookup per conversation (up to 200/invocation, 1.49M calls / 22,251s cumulative). It now prefetches every conversation's existing message keys in a single `.in(conversation_id, chunk)` query (chunks of 200) into a `Map`, and adds newly-inserted keys back into that map. (2) **Health heartbeat throttle**: `recordIntegrationHealth` skips an `ok` upsert if the same isolate wrote one for that integration within 60s (was ~920k upserts, mostly `intercom-webhook` firing per delivery). Failures are never throttled and clear the throttle so recovery is written immediately. (3) **Settings cache**: `getSettings(sb)` caches the single `settings` row for 30s per isolate (table was seq-scanned ~2.16M times). `slack-events` and `intercom-webhook` use it; `slack-events` calls `invalidateSettings()` after auto-adding a monitored channel |
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

## 15. Ticket Creation Notifications

- On every ticket creation, a group DM is sent to hardcoded Slack user IDs: `U0AFU714807` (Kristina) and `U091GANMA2U` (Joel)
- The same message is also posted to channel `C0BDZAY8R8A` via `chat.postMessage` (independent try/catch — channel failure cannot break DM or ticket creation)
- Channel-post failures are logged with the prefix `[ticket-channel-notify]`; `not_in_channel` errors include a hint to `/invite` the bot
- Contains links to both the Slack thread and the Intercom conversation

---

## 16. Intercom API Version

All Intercom API calls use `Intercom-Version: 2.13` (bumped from `2.11`; the constant lives in `intercomHeaders` in `supabase/functions/_shared/v3.ts` and is mirrored in the standalone functions).

**Why 2.13 (commit `3f5272d`).** A read-only version spike (temporary edge function, GET-only, deleted after the run) probed 2.10 / 2.11 / 2.12 / 2.13 / Unstable against the same conversation: **2.13 is the MINIMUM version that returns `event_details` on conversation parts** — 2.10–2.12 return none. `event_details` is what carries attribute-change history (`event_details.attribute.name`, `event_details.value.name`), which the Severity-change / triage metrics require. Notes:

- **Regression-checked as additive-only** vs 2.11 — no field our sync reads was dropped, so the bump is safe for `sync-v3-open`, `sync-v3-closed`, `reconcile-v3-open` and every other caller. Verified end-to-end by invoking the open and closed syncs after deploy.
- **2.13 supplies `value.name` (the NEW value) but NOT `value.previous`.** The previous value is therefore **derived by chronological ordering** in the engine, not read from the payload.
- **`Unstable` deliberately NOT used** — it is un-pinned and can change under us.


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

### Left-nav information architecture (regroup `b5b66e0`)
- The rail went from a **flat ~17-item alphabetical list** to **6 rail items grouped by USE** (job-to-be-done), each one a hover-flyout. The two `v2` nav entries were removed.
- Structure:
  - **Reports** ▸ Analytics (`/`) · Analytics v3 · Insights · SLA Report
  - **Customer report** — standalone top-level link (kept there because CSMs were already told it's there; moves under Reports later)
  - **My queue** (`/my-queue`) — standalone top-level link, added 10 Sep 2026 (see "My queue")
  - **Issues** ▸ Triage (`/triage`) · Dev escalations (`/escalations`) · Inbox (`/conversations`) · Inbox v3
  - **Dashboards** ▸ SLA Dashboard (`/sla`) + one entry **per teammate**, data-driven (see below)
  - **Tools** ▸ Import · SLA Workbench · Backlog · Prospects · SLA What-if
  - **Admin** ▸ Customers · Settings · Knowledge · Flow · Changelog · SLA Policy (admin-only)
- **Why by use, not by name:** you navigate by intent ("report", "work the queue", "configure"), and the flat list overflowed a 13" screen.
- **Deliberate tradeoff:** a feature family is **split across use-groups** — SLA Report → Reports, SLA Dashboard → Dashboards, SLA Workbench → Tools. Mitigated by keeping the family name in the **child label** ("SLA Report" / "SLA Dashboard" / "SLA Workbench") so it stays findable by reading.
- **Mechanic:** one **generic per-row hover flyout** (generalized from the old single hardcoded Dashboards flyout), positioned at each group row via `getBoundingClientRect().top`, rendered outside the sidebar so it isn't clipped, with the same ~150ms close debounce so the mouse can cross into it. A group that shrinks to exactly **one item degrades to a plain link** — future-proofing as legacy/v2 options fall off.
- **De-nav'd, then deleted:** the v2 nav entries were removed first; on 2 Sep 2026 the `/analytics-v2` and `/inbox-v2` routes, pages, and edge functions were deleted outright (see "Inbox v2 sandbox and Analytics v2 — RETIRED AND REMOVED").

### Dashboards group is roster-driven (`show_dashboard`)

The per-owner `/my/*` children are **no longer hardcoded**. `src/hooks/useDashboardTeammates.ts` loads `public.teammates WHERE active AND show_dashboard AND role <> 'ai'` ordered by name and maps each row to `{ to: "/my/" + name.toLowerCase(), label: name }`; the static SLA Dashboard entry stays pinned first.

- `teammates.show_dashboard` is a `boolean NOT NULL DEFAULT false` column, backfilled `true` for the five names that were previously hardcoded (Joel, Kristina, Tine, Eren, Matt).
- Toggled per row from the **Teammates panel** in Settings (`AdminMappingCard.tsx`), next to the existing Active switch. Admin-gated; the switch is **disabled for `role = 'ai'`** so Sam can never be given a dashboard.
- **Both gates apply.** An inactive teammate drops out of the flyout even with `show_dashboard = true`. This is a live behavior change: **Joel** is `active = false` on the roster, so he no longer appears in the flyout even though his flag is on. Flip `active` back on (or accept the removal) — the data was not changed to paper over it.
- **Fallback:** if the query errors the hook returns the previous hardcoded five, so the nav never renders empty.
- **Scope fence — this is nav curation, not access control.** `/my/:owner` remains reachable by URL for any owner name. `OWNER_OPTIONS` (`Conversations.tsx`, `ConversationDetail.tsx`, `TestChannelReview.tsx`) and `OWNER_MAP` (`BulkImportReview.tsx`) stay hardcoded — they include non-teammate owners (`CSM`, `Sam`) and drive filtering of historical data, so repointing them at the roster is a separate pass.



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

### Owner dashboards v3 — `/my-v3/:owner` (parallel, read-only)

**WHAT.** `src/pages/OwnerDashboardV3.tsx` is a v3-data mirror of the legacy `/my/:owner` dashboard, reachable from the new **Dashboards (v3)** sidebar group (same `useDashboardTeammates` roster, `/my/` swapped for `/my-v3/`). It reads `intercom_tickets_v3` only — the legacy `/my/*` pages still read `conversation_mappings` / `gmail_conversations` / `manual_conversations` and are untouched.

- **Population:** `owner ilike :owner` AND `intercom_created_at >= CLEAN_DATA_START_ISO` (June 1 2026 v3 data floor) AND `lifecycle_status <> 'transferred_out'`, limit 2000, newest first.
- **Two tabs:** *Active* = `lifecycle_status ∈ {open, reopened_after_finalize}` sorted oldest-first (work the queue); *Closed* = everything else, newest-first.
- **Presentation:** the shared issue-view template — `IssueTable` + `issueColumns` (id/subject/contact/customer/age) + `IssueDetailSheet`, `displaySubject` for subject overrides, `useCustomerLabels` for customer names. Single scroll, no pager.
- **READ-ONLY by design:** no replies, no field writes, no override tables. Editing stays on Triage / Inbox v3 / the ESH write panel.
- **Parallel, not a cutover:** legacy `/my/:owner` remains the default **Dashboards** group. Retiring it is a separate, later decision once v3 numbers are trusted.
- Verified against Matt: 21 active / 146 closed, matching direct SQL over the same predicate.

### Intercom webhook — acknowledge first, process in the background

**WHY.** Project monitoring caught `POST /functions/v1/intercom-webhook` returning 503 x16, 504 x2 and 520 x1 over one log window (2026-08-25). The handler did everything inside the request — signature verify, Supabase reads/writes, Intercom conversation fetch, Gmail email/subject matching, Slack posts — so one slow upstream call held the socket until the platform killed it, and bursts of concurrent deliveries piled up long-lived instances.

**SHAPE NOW (`supabase/functions/intercom-webhook/index.ts`).**
- `Deno.serve` does only: CORS preflight → read body → `verifyIntercomSignature`. A bad signature still returns **401**; nothing else is synchronous.
- It then returns **200 `{ ok: true, accepted: true }` immediately** and hands the payload to `handleEvent(rawBody)` via `EdgeRuntime.waitUntil`. `handleEvent` is the entire previous handler, moved verbatim — every topic branch, the dedup claims, the Gmail linking tiers, the cross-thread link guard, `pending_intercom_links`, and the Slack posts are unchanged.
- Each background run logs `[timing] handleEvent <ms> status=<code>` so the branch cost is observable.

**OUTBOUND TIMEOUTS.** A module-level `fetch` wrapper attaches `AbortSignal.timeout(8000)` to any call that does not already pass a signal. A hung Intercom or Slack call now fails fast and is handled instead of running out the request clock.

**DEAD LETTER — the replacement for Intercom's retry.** Because we answer 200 before doing the work, Intercom no longer retries a failure. Instead `recordWebhookFailure()` writes `public.intercom_webhook_failures` (`topic`, `intercom_conversation_id`, `error`, full `payload` jsonb, `created_at`, plus `replayed_at`/`replay_ok` for later replay) and posts a `:shield:` alert to `#enterprise-support-hub-alerts` under the existing "Support Hub Guard" identity. Both are wrapped in try/catch: a dead-letter write can never mask the original error. RLS: authenticated SELECT, service_role full.

**VERIFIED (2026-08-26).** Bad-signature POST → 401 (negative case, checked). 13 live deliveries after deploy all logged `status=200`, 613–1931 ms. `intercom_webhook_failures` = 0 rows. **UNVERIFIED:** the 24-hour 503/504/520 count against the 19-failure baseline — that window has not elapsed. Replay of a stored dead-letter payload is also UNVERIFIED (no failure row has occurred yet to replay), and no replay UI exists yet.



To add a new owner:
1. Append to `OWNER_OPTIONS` in `src/pages/Conversations.tsx` (also extend the `OwnerFilter` type), `src/pages/ConversationDetail.tsx`, and the `SelectItem` list in `src/pages/TestChannelReview.tsx`.
2. Add to `OWNER_MAP` in `src/pages/BulkImportReview.tsx` (lowercase name → display name).
3. Add a sidebar entry in `src/components/AppLayout.tsx` `dashboardItems` (route `/my/<lowercase>` is auto-rendered).
4. For Intercom auto-assignment, add them in Settings → **Teammates** card (see below). The card writes `public.teammates` and mirrors the mapping into the legacy `settings.admin_owner_map` blob that the sync functions still read.

### Teammate roster — `public.teammates` (canonical)

**WHAT.** `public.teammates` is the single source of truth for who's who: `intercom_admin_id` (text, UNIQUE, NOT NULL), `email`, `name`, `role` (`support` | `other` | `ai`), `active` (default true), `created_at`/`updated_at` (`update_updated_at_column` trigger). RLS mirrors `v3_customer_accounts`: authenticated SELECT; INSERT/UPDATE/DELETE gated on `has_role(auth.uid(),'admin')`. Seeded with 6 rows: Sam `9520895` / lovable@parahelp.com / `ai`; Joel `9852095` (`active=false`, departed); Kristina `9985999`; Tine `10476723`; Matt `10765619`; Eren `10475465` — the last five all `support`.

**WHY.** Owner identity was previously smeared across a JSON blob (`settings.admin_owner_map`), hardcoded `OWNER_OPTIONS` arrays, and `ADMIN_OPTIONS` in `parseThread.ts`. A real table gives the SLA work a stable place to ask "is this admin a human support engineer, the AI agent, or someone else?" without string-matching names.

- `active` is **roster status only** (departed / on-leave). It does **NOT** affect SLA counting — historical replies from an inactive teammate always count. `role` is what the SLA support roster keys off (`support` = counts for First Response, `ai` = Sam, excluded).
- **`role` is load-bearing for SLA.** The SLA engine's First Response metric reads the `role='support'` roster (see Track B → *Support-based First Response*): `useSlaBatch` loads those rows' `email` + `intercom_admin_id` and passes them into `computeSla`. `role='ai'` (Sam) is therefore excluded from First Response by construction. Changing someone's `role` changes FR numbers; changing `active` does not.
- Managed from Settings → Teammates card (`src/components/AdminMappingCard.tsx`): inline add / edit / remove with admin-gated writes, saving immediately (no Save-settings round-trip).

**Dual-write, deliberately.** `settings.admin_owner_map` is still the reader for owner auto-attribution in `intercom-webhook`, `poll-intercom-inbox`, `sync-v3-open`, `sync-v3-closed`, `backfill-enterprise-inbox`, and `src/pages/AnalyticsV3.tsx`. Rather than risk breaking attribution, every teammates mutation regenerates the blob from the **full** roster (active *and* inactive — historical attribution must keep resolving) and writes it back to `settings`. Retiring the blob and repointing those seven readers at `teammates` is a later tech-debt pass.



---

## Intercom CSAT capture

Intercom's `conversation_rating` (1–5 plus optional `remark`) is captured into `manual_conversations` and `gmail_conversations` via three columns: `csat_rating smallint`, `csat_remark text`, `csat_rated_at timestamptz`. A trigger (`validate_csat_rating`) enforces 1–5 on insert/update.

Capture paths:
- `import-intercom-ticket` and `bulk-import-intercom` set CSAT on insert if Intercom returns a rating.
- `refresh-intercom-csat` edge function pulls ratings for any Intercom-linked conversation that doesn't yet have one. Runs every 6h via pg_cron job `refresh-intercom-csat-6h` against `?mode=recent` (only conversations resolved in the last 14 days). Call with `?mode=backfill` for a one-time historical sweep.
- The `poll-intercom-inbox` and `intercom-webhook` paths intentionally do NOT touch CSAT — ratings arrive minutes-to-days after resolution, so the cron is the source of truth.

Surfaced on `/stats` under "Customer satisfaction" with avg, total, response rate (ratings / resolved Intercom-linked conversations in scope), 1–5 distribution chart, and a click-through list of recent 1–2★ ratings.

## CSAT rater identity and rating overrides (v3)

Two things can make a raw Intercom rating misleading: the rater is internal, or the rating is a documented misfire. Neither is hidden.

**Rater identity.** `intercom_tickets_v3` carries `csat_rater_contact_id`, `csat_rater_external_id`, `csat_rater_name`, `csat_rater_email`, `csat_rater_is_internal`, filled by the BEFORE INSERT/UPDATE trigger `trg_v3_apply_csat_rater` (function `public.v3_apply_csat_rater`) from `raw_payload.conversation_rating`. In every observed rated ticket the rater contact is the ticket requester, so name/email mirror `contact_name` / `contact_email`. `is_internal` is true when the contact email is `@lovable.dev`, matches a `teammates.email`, or the rating contact's `external_id` is `slack:<id>` matching `teammates.slack_user_id`. Backfill at build time: 61 rated tickets → 8 internal (avg 4.88), 53 external (avg 4.42).

**Overrides.** `public.csat_overrides` (unique per `ticket_id`, `action = 'exclude'`, `reason` required ≥5 chars, `created_by` / `created_by_email`, `original_rating`). The rating itself is never edited or deleted — the override is an attributed, visible suppression shown next to the rating. RLS: read for all authenticated, insert/update/delete gated on `public.can_edit(auth.uid())`.

**Counting authority.** `src/lib/csat.ts` is the single place that decides which ratings count: `useCsatFilters` (persisted in localStorage under `esh.csatFilters.v1`, shared across surfaces, defaults exclude-internal ON and exclude-overridden ON), `useCsatOverrides`, `summarizeCsat`, `isRatingCounted`, `csatExclusionNote`. Every surface reports how many responses each rule removed rather than silently shrinking `n`.

Surfaces: Analytics v3 (average CSAT, response rate, per-customer CSAT, `CsatFilterMenu` in the filter bar), Trend report (monthly average with `n excl.`), Customer report (CSAT positive card), Inbox v3 detail sheet (rater name/email, "Internal rater" and "Excluded" pills, `CsatOverrideDialog`).

**Dedicated CSAT report.** `/csat-report` (`src/pages/CsatReport.tsx`, nav under Reports) is a read-only view of every rated ticket in a window. It reads `intercom_tickets_v3` anchored on `csat_rated_at` (all rated rows carry it) and uses the same range picker as Analytics v3 (last 7/14/30 days, this month, last month, custom), clamped to the June 1 2026 clean-data floor. KPIs: average CSAT, % positive (4–5), response rate (counted ratings ÷ tickets finalized in the same window), and an explicit "excluded from the average" card split internal vs overridden. Below that: a 1–5 distribution bar and a table of every rated ticket (rating, subject via `displaySubject`, raw Intercom ID, customer, rater name/email, remark, rated date, owner, counting pills, inline `CsatOverrideDialog` with reason/author). Filters: customer, rating, free text; CSV export covers the currently scoped rows including a `counted` column. All counting flows through `src/lib/csat.ts` and the shared `CsatFilterMenu` — the report introduces no second rule.

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

Wired into: `poll-intercom-inbox` (search 4xx + on success), `intercom-webhook` (auto-import fetch failure + success), `refresh-intercom-csat` (aggregated per run; auth_error only if every fetch was 401/403), `import-intercom-ticket` (per call), `poll-gmail` (success + error categorised by `PollErrorCategory`: oauth/token/scope → auth_error, else error), `sync-v3-closed` (`v3_closed_sync`), `poll-slack-closed-won` (`slack_closed_won_poll`: Slack API/gateway errors, insert failures, and malformed extracted domains).

**Standing rule:** any scheduled/background function must report through `integration_health` — a run that does nothing must be distinguishable from a run that failed. New pollers add their key to `IntegrationKey` in `_shared/integration-health.ts`, to `INTEGRATIONS` in `src/components/IntegrationHealthCard.tsx`, and to `INTEGRATIONS` in `supabase/functions/integration-health-alert/index.ts` (all three lists must stay in lockstep). Data-quality anomalies (not just HTTP failures) count as `error` — silently skipping bad input is not acceptable.

**Run-level aggregation in `poll-intercom-inbox`**: the function loops through one team-assignee query plus N admin-assignee queries. Each failed search records an `auth_error`/`error` mid-run, but the function only writes `intercom_poll = "ok"` at the end of the run if `upstreamFailed` stayed false. If any query failed, the final write re-stamps the last `auth_error`/`error` so it sticks. Without this, a fully 401'd run (e.g. expired `INTERCOM_API_TOKEN`) would still surface as Healthy because the trailing `"ok"` upsert reset `consecutive_failures` to 0. The same pattern should be used for any future poller that fans out multiple upstream calls per invocation.

UI: `src/components/IntegrationHealthCard.tsx` is mounted at the top of Settings. It polls `integration_health` every 60s and renders a badge per integration — Healthy / Stale (last success older than per-integration `maxStaleMin`) / Auth error / Failing. A stale Intercom/Gmail badge is the user's signal that the API token needs to be re-pasted. The card header also has a **Send test alert** button that invokes `integration-health-alert` with `{ test: true }` and surfaces Slack errors (e.g. `not_in_channel`) as a toast so the Slack wiring can be verified without waiting for a real failure.

### Slack alerting for integration health — `integration-health-alert` edge function

Runs every 10 minutes via `pg_cron` (`integration-health-alert-every-10min`). For each row in `integration_health` it computes a severity (`ok` / `warn` / `auth` / `error`) using per-integration freshness windows (Intercom poll 30min, Gmail 30min, Intercom CSAT 3min, Intercom import 1440min) plus `last_status`. Non-ok severities are posted to `#enterprise-support-hub-alerts` via Slack `chat.postMessage` using `SLACK_BOT_TOKEN` (the same Ask Lovable bot used elsewhere — it must be `/invite`d to the alerts channel or posts fail with `not_in_channel`). Recoveries (severity transitioning back to `ok`) post a ✅ message.

De-duplication: `integration_health.last_alerted_status` + `last_alerted_at` track the most recent posted severity per integration. The same severity is re-posted at most every 6 hours; a severity change always posts immediately. Passing `{ test: true }` (or `?test=1`) short-circuits the loop and posts a single `:satellite_antenna: *Test alert*` message — used by the Settings button.

### Scheduled-job visibility — `public.esh_cron_jobs()` + `ScheduledJobsCard.tsx` (26 Aug 2026)

`integration_health` only covers what a function reports about *itself*. A schedule that fails before the target function runs at all — malformed `headers` literal, unscheduled job, disabled job — writes nothing, and a silent scheduler failure looks identical to a healthy quiet morning. `public.esh_cron_jobs()` closes that gap.

- `SECURITY DEFINER`, `STABLE`, `SET search_path = public`, gated by `has_role(auth.uid(), 'admin')`; `EXECUTE` granted to `authenticated` only, revoked from `PUBLIC`, never `anon`.
- Returns `jobname`, `schedule`, `active`, `command_summary`, plus `last_run_at` / `last_status` / `last_message` from the newest `cron.job_run_details` row per job.
- `command_summary` **redacts** `Authorization` and `Bearer` values before they leave the database, truncated to 600 chars. `apikey` values are NOT redacted — those are the publishable anon key that already ships in the client bundle.

UI: `src/components/ScheduledJobsCard.tsx`, mounted at the bottom of Settings, admin-only (renders nothing otherwise). Per-job badge: **Ran OK / Overdue / Failed / Disabled / Never run**. Overdue = no run within twice the parsed cadence (5-min floor); `cadenceMinutes()` returns `null` for cron expressions it cannot reason about and the card then never claims a job is overdue. A missing function surfaces an explicit "needs the introspection migration" notice rather than an empty list pretending to be zero jobs.

**Read-only by design.** There is no create / alter / unschedule path from the app or from the agent — cron jobs on this project are authored by hand in the SQL editor, because agent SQL is refused on `cron.*` internals and the managed HTTP-schedule tools are not exposed here.

### Notion registry publish schedule — `publish_registry_notion_daily`

`pg_cron` job at `0 5 * * *` (05:00 UTC) posting to `publish-registry-notion`. Placed 60 min after `poll-slack-closed-won` (04:00) and 30 min after `sync-parahelp-routing` (04:30) so an account registered that morning is enqueued before the page is rewritten.

Created 26 Aug 2026, once the Notion connection was linked (the job was deliberately withheld until then so a missing credential could not alarm daily). The first attempt shipped a malformed headers literal — `{"Content-Type":"application/json",apikey":"..."}`, missing an opening quote — which would have failed the `::jsonb` cast on every fire; it was caught by reading the command back through `esh_cron_jobs()` *before* the first fire and re-scheduled.

**Status: VERIFIED (27 Aug 2026).** The job fired at **05:00:07 UTC** on its first scheduled occurrence; `integration_health.notion_registry_publish` = `ok`, no failure recorded. It was a **real write, not a no-op**: `notion_registry_changed_at` equals `notion_registry_synced_at` (05:00:07), so the domain set had changed and the page was rewritten — **504 domains**. Negative case that makes pg_cron status the only honest signal in general: an unchanged registry writes nothing to Notion and only re-stamps the hash, so a healthy no-op morning is indistinguishable from a skipped run in `integration_health` alone.

### Cross-thread link conflict alerts — `intercom-webhook` `postGuardAlert`

When the inverse-uniqueness guard (Option 2) refuses to stamp a second Gmail thread on an Intercom ticket that is already linked to a different thread, `postGuardAlert()` posts a `:shield: Cross-thread link blocked` message to `#enterprise-support-hub-alerts` (channel ID `C0B9NSBM60H`) using `SLACK_BOT_TOKEN` with `username: "Support Hub Guard"` / `icon_emoji: ":shield:"` (same bot as Support Hub Health, just a per-message identity override). Two call sites mirror the two guard log lines: `[cross_thread_link_conflict:email]` and `[cross_thread_link_conflict:subject]`. The post is non-blocking — failures are caught and logged so the guard always returns. Expected volume is ~0.7 alerts/day based on historical conflict rate (see chat history Jun 10).

### Inbox v2 sandbox and Analytics v2 — RETIRED AND REMOVED (2 Sep 2026)

The v2 parallel mirror (`inbox_v2_tickets`) was the validation sandbox that preceded Inbox v3. Once v3 became the reporting system of record (finalized closed tickets + the active-clock engine), v2 carried no reporting value, so it was removed end-to-end rather than left de-nav'd. Prior behaviour is preserved in git history and in the Inbox v3 sections below.

- **Code removed:** edge functions `sync-inbox-v2` and `classify-inbox-v2-engagement` (deleted from the repo and undeployed); pages `src/pages/InboxV2.tsx` and `src/pages/AnalyticsV2.tsx`; helper `src/pages/inbox-v2/engagement.ts` (`effectiveEngagement()` / `hasNoEngagementTag()` / `NO_ENGAGEMENT_TAGS`). Routes `/inbox-v2` and `/analytics-v2` no longer exist — previously de-nav'd but still reachable by URL, now 404. `src/pages/inbox-v3/rsa.ts` keeps its own engagement-chain shape and never imported the v2 helper.
- **Cron removed:** `sync-inbox-v2-frequent` / `sync-inbox-v2-nightly` were unscheduled during the 2 Sep cron-credential migration. Deleting the functions makes any surviving schedule a 404 no-op. UNVERIFIED: agent SQL cannot read `cron.job`, so a stray v2 schedule cannot be ruled out by inspection — the last observed v2 write was 16:45 UTC on 2 Sep, before the functions were deleted.
- **Health key corrected:** `sync-v3-closed` had been writing its heartbeat into the `inbox_v2_sync` bucket ("reuse v2 health bucket for now"), so the Settings row labelled *Inbox V2 sync* was actually reporting v3 closed-sync freshness with a wrong 30-min staleness window. It now writes `v3_closed_sync`, surfaced as **Inbox V3 closed sync** (24h window, "Run now" → `sync-v3-closed`) in `IntegrationHealthCard.tsx` and mirrored in `integration-health-alert`. The `inbox_v2_sync` row was deleted from `integration_health` and the key removed from the `IntegrationKey` union.
- **Data:** `public.inbox_v2_tickets` (844 rows, ~9.4 MB after compaction) is dropped separately from the SQL editor — the migration tool refuses destructive DDL. No shipped code reads the table as of this change, so the drop is safe whenever it is run.



### Changelog page — `/changelog`

Self-service release notes shown in the app. Backed by `public.changelog_entries` (id, entry_date, title, body, tags `text[]`, area, author_user_id). Tags are one of `new` / `improved` / `fixed` / `internal` and drive the badge color. RLS allows any authenticated user to read, insert, update, and delete entries — same trust model as Settings and Knowledge. Updated_at is maintained by the shared `update_updated_at_column` trigger.

UI: `src/pages/Changelog.tsx` lists entries reverse-chronologically, grouped by month with a sticky month header. `src/components/changelog/AddEntryDialog.tsx` is the add/edit dialog (date, title, body, tag multi-select, optional area). Each entry has inline edit/delete controls. Sidebar entry sits below Knowledge in the bottom utility section, icon `ScrollText`.

Out of scope: no public/marketing feed, no RSS, no auto-generation from git/edit history, no Slack/email broadcast on new entries. Add entries manually whenever something user-visible ships.

### Inbox v3 — `/inbox-v3` and `/analytics-v3`

Reporting-grade mirror of Intercom enterprise tickets, built as a parallel stack to v2. Closed tickets are the reporting unit: they get one full GET on finalize and are then frozen (`lifecycle_status='finalized'`). Open tickets get cheap search-payload-only refreshes (no per-conversation GET). Hard data floor `CLEAN_DATA_START_ISO = 2026-06-01T00:00:00Z` — nothing earlier is fetched, stored, or queryable in v3.

- Tables (migration `intercom_tickets_v3` + `intercom_sync_jobs_v3`, both authenticated-read / service-role-write):
  - `intercom_tickets_v3` — one row per conversation. Columns: `intercom_conversation_id` (unique), `team_assignee_id`, `admin_assignee_id`, `owner`, `contact_name/email/domain`, `subject`, `state`, `lifecycle_status` (`open`/`finalized`/`reopened_after_finalize`), `product_area`, `classification`, `tags text[]`, `csat_rating/remark/rated_at`, pre-computed `time_to_first_admin_reply_s` and `time_to_resolve_s` (snapshot of Intercom `statistics.time_to_admin_reply` and `time_to_last_close` taken at finalize), `intercom_created_at/updated_at/closed_at`, `finalized_at`, `reopen_count`, `last_reopened_at`, `last_synced_at`, `last_full_fetch_at`, `raw_payload`. Engagement / AI classifier columns deliberately omitted — owner-at-finalize is enough.
  - `intercom_sync_jobs_v3` — one row per sync invocation. `kind` ∈ `closed_backfill` / `open_refresh` / `gap_scan`, `status`, `cursor_ts`, `window_start/end`, counters (`processed/inserted/updated_count/failed`), `last_error`, timestamps. Latest row per kind drives the Settings UI.

- Edge functions (all in `supabase/functions/_shared/v3.ts` for shared helpers):
  - **`sync-v3-closed`** — incremental mode reads cursor from latest `closed_backfill` job and walks closed-state enterprise conversations with `updated_at > cursor`, clamped to `CLEAN_DATA_START_UNIX`. For each: bulk pre-fetch existing rows; finalized rows with matching `intercom_updated_at` are skipped; finalized rows with newer `updated_at` get a full GET and are evaluated against authoritative reopen signals — `state !== "closed"` OR `statistics.count_reopens > reopen_count_at_finalize` (snapshot stored at finalize) — only then flipping to `reopened_after_finalize` and `reopen_count++`. Otherwise it's a silent nudge: `silent_update_count++` and `last_silent_change` is written with a diffed allowlist (CSAT, tags, custom_attributes incl. Conversation Label, admin_assignee, conversation_parts count). CSAT submissions and tag/label edits therefore no longer trigger reopen. Everything else gets a full GET + finalize write (which also persists `reopen_count_at_finalize`). Time-boxed at 120 s; cursor advances to max `updated_at` seen. **Backfill mode** (`{mode:"backfill",windowStart,windowEnd}`) filters/sorts by `statistics.last_close_at` (not `updated_at`) so the window aligns with `sync-v3-gap-scan`'s counts. Backfill paginates to exhaustion (no `MAX_PAGES` cap, only the 120 s wall-clock budget). The finalized-row reopen/silent-nudge branch lives in `_shared/v3.ts` (`decideFinalizedUpdate` + `buildReopenUpdate` + `buildSilentNudgeUpdate`) and is shared with `sync-v3-open` so the two paths can't drift.
  - **`sync-v3-open`** — search-payload-only refresh of enterprise tickets in `state IN (open, snoozed)` updated in the last `windowHours` (default 2). Snoozed inclusion is deliberate: snoozed tickets aren't `closed`, so without it they'd fall through the gap between this and `sync-v3-closed`. Upserts the minimum: state, admin assignee, owner, subject, contact, timestamps. Never overwrites `product_area`/`classification`/`csat_*` (those are only trusted at close); `tags` ARE refreshed on the full-fetch path (see below). No per-conversation GET on regular open rows. **Finalized-row recheck:** if a conversation in the open/snoozed search already has `lifecycle_status='finalized'` in our DB, it routes to the shared `decideFinalizedUpdate` helper (same one `sync-v3-closed` uses) — fetches the full payload and either flips to `reopened_after_finalize` (writing `reopen_count++`, `last_reopened_at`, refreshed `state`/`raw_payload`) or records a silent nudge (`silent_update_count++`, `last_silent_change`, refreshed CSAT/tags). This closes the gap where a reopened finalized ticket no longer appears in `sync-v3-closed`'s `state=closed` search. **Intercom Ticket finalize path:** conversations converted to Intercom Tickets keep top-level `state="open"` / `open=true` even when resolved — the real status lives in `conv.ticket.state`. `sync-v3-closed`'s `state=closed` filter therefore never sees them. When the open-sync search payload shows `ticket.state ∈ {resolved, archived}` on a non-finalized row, it calls the shared `finalizeConversation` helper (`_shared/v3-finalize.ts`) which does a single GET, writes the full finalized row (product_area, classification, tags, CSAT, stats), sets `lifecycle_status='finalized'`, and falls back `intercom_closed_at = updated_at` because Tickets have no `statistics.last_close_at`. `decideFinalizedUpdate` also treats resolved/archived tickets as closed-equivalent so already-finalized tickets don't false-flag as reopens on every subsequent sweep. Response includes `tickets_finalized` counter. **Delta-gated attribute refresh (Phase 1 Batch 1, commits `d65e5fe` + `4773257`):** open/reopened tickets used to carry STALE or NULL `custom_attributes` — the open path wrote a minimal search-payload row and never called `syncTicketAttributes`, so `Severity` (which drives the SLA target) was only refreshed at close, and open tickets were judged against the wrong or no target. Verified on a test ticket reading Sev 4 in our store while Intercom said Sev 1. Now `needFull = new to us OR changed since our last FULL fetch`, where the delta compares the live `updated_at` to `last_full_fetch_at` — deliberately **not** `intercom_updated_at`, which the minimal path itself advances and would therefore suppress full fetches forever. When `needFull`, a single `GET /conversations/{id}` refreshes `raw_payload`, `custom_attributes` (via `syncTicketAttributes` → both the jsonb mirror and the EAV table), `writeV3Signals`, and `last_full_fetch_at`; a ticket found closed/resolved at GET time is routed to `finalizeConversation` instead. Unchanged tickets stay on the cheap minimal search-payload upsert with no GET. `product_area`/`classification`/`csat` deliberately remain close-only (`sync-v3-closed` owns them). **Tags on open (commit `4918a70`):** the full-fetch upsert now also writes `tags: extractTags(icData)`. WHY: tags carry the dispositions (`enterprise-prospect`, personal, fyi, …) that the customer-resolver trigger `intercom_tickets_v3_apply_customer` reads via `NEW.tags`. Writing tags on the open upsert fires that trigger, so a dispositioned OPEN ticket is classified/excluded in near-real-time — e.g. an `enterprise-prospect` ticket resolves to `prospect_unmapped` and drops out of the Customers "unattributed" (unknown) queue instead of sitting there until close. Response includes an `attr_refreshed` counter. This is poll-based only: **Batch 2** (webhook triggering the same per-ticket full fetch in real time) is **not** implemented. Severity-change *history* tracking IS now live — `event_details` arrives since the Intercom-Version bump to **2.13** (see §16), and the triage metric built on it is documented under Track B.
  - **New-ticket Slack alert (2026-08-12)** — `_shared/new-ticket-alert.ts`, called from `sync-v3-open` on the two upsert paths whenever the upsert **inserted** a row (new to our store) AND `intercom_created_at` is within 24 h. Posts one message to Slack `C0BPDU4JH71` (`#enterprise-support-tickets`, overridable with env `NEW_TICKET_ALERT_CHANNEL`) via `SLACK_BOT_TOKEN`: Intercom deep-link, subject, contact, owner, and an "awaiting triage" line. **Dedup is the schema**, not a query: `public.new_ticket_alerts` has `intercom_conversation_id` as PRIMARY KEY and the claim row is inserted BEFORE the Slack call — a PK collision means "already announced" and we skip; a Slack error deletes the claim so a later run retries. The 24 h age gate exists because the daily `windowHours=720` wide sweeps would otherwise announce historical tickets as new. One alert per ticket — deliberately no breach re-nudge. The helper never throws (alerting must not break a sync run) and no-ops when `SLACK_BOT_TOKEN` is unset. Response carries an `alerted` counter. **Prerequisite:** the bot must be invited to the channel.
  - **Float coverage schedule (12 Aug 2026)** — who the new-ticket alert @-mentions is now **schedule-driven**. `public.float_coverage_shifts` holds one row per person per coverage block: `slack_user_id`, `display_name`, inclusive `starts_on`/`ends_on` dates, `start_time`/`end_time`, an IANA `time_zone`, and `active`. Admin-only writes (RLS via `has_role`), read for any authenticated user. Matching lives in **two byte-identical copies** — `src/lib/floatCoverage.ts` (unit-tested, 21 cases) and `supabase/functions/_shared/float-coverage.ts` (Deno cannot import from `src/`) — so the page's "on call right now" and the actual Slack ping can never disagree; **edit both or neither**. Local wall-clock is derived with `Intl.DateTimeFormat` rather than a stored offset, so a noon-Pacific shift stays at noon across DST. Windows are **start-inclusive, end-exclusive** (back-to-back shifts don't double-ping); `end_time < start_time` means the block crosses midnight and its early-morning tail is matched against the *previous* local date, so the last day of a range keeps its overnight hours. **Overlaps are intentional** — everyone covering the instant is pinged. Weekends are not skipped automatically: create separate rows for weekday-only cover. Mentions posted = union of (shifts covering `now`) ∪ (`settings.new_ticket_alert_mentions`, an always-on escape hatch, normally blank); env `NEW_TICKET_ALERT_MENTION` overrides both for tests. **Nobody on shift means no mention at all** — the alert still posts, it just doesn't page anyone at 2 AM. A failed shift or settings read degrades to fewer mentions, never a dropped alert. Surface: `/float-coverage` (Admin nav) with a live status card, admin-gated shift editor, and the schedule table. `teammates.slack_user_id` (nullable, editable in the Teammates card) feeds the shift editor's person picker.

  - **`sync-v3-gap-scan`** — daily safety net. Buckets last 30 days into UTC days (clamped to floor), asks Intercom `total_count` of closed enterprise tickets per day (`statistics.last_close_at` window) vs our `lifecycle_status='finalized'` count per day. For any day where we're short, self-invokes `sync-v3-closed` in backfill mode with that day's window. Catches the "we never finished backfilling" class of bug.


- Crons (registered via `cron.schedule`, not via migration):
  - `sync-v3-closed-frequent` — every 15 min, `{mode:"incremental"}`
  - `sync-v3-open-frequent` — every 5 min, `{windowHours:6}` (widened from 2 h on 2026-06-30 to compensate for Intercom search-index lag — any single `updated_at` now gets ≈72 chances to be picked up before falling out of the window)
  - `sync-v3-open-daily-wide` — 06:15 UTC, `{windowHours:720}`
  - `sync-v3-open-evening-wide` — 18:15 UTC, `{windowHours:720}` (second daily 30-day sweep so reopens are rechecked twice per day, not just once)
  - `sync-v3-gap-scan-nightly` — 04:00 UTC daily, `{lookbackDays:30}`
  - `sync-v3-gap-scan-daily` — 06:45 UTC daily, `{lookbackDays:30}`

- UI:
  - `/inbox-v3` (`src/pages/InboxV3.tsx`) — read-only, two tabs. **Finalized** tab: full column set (subject, contact, owner, product area, classification, State, lifecycle, CSAT, resolve, closed); lifecycle filter Finalized / Reopened / All closed-side. The **State** column shows the live Intercom state from the last sync and is rendered in red when `state !== 'closed'` on a finalized row (drift = pending reopen detection). **Active** tab: `lifecycle_status IN (open, reopened_after_finalize)`; reduced columns (ID, subject, contact, owner, state, lifecycle, opened, last updated, age) since open rows lack product_area/classification/tags/csat/resolve; sorted oldest-first; age >14 d highlighted. Owner + search filters shared across tabs. Detail sheet hides finalize-only fields for active rows. **Tab attention badges**: each `TabsTrigger` renders a red `AlertTriangle` + count when rows need a look — Active = `last_synced_at < now() - 30 min` (stale, sync hasn't touched), Finalized = `lifecycle_status='finalized' AND state != 'closed'` (drift). **RSA badge** (Required Support Action) renders on every row and inside the detail sheet; clicking it cycles `rsa_override`: `null` (derived) → `true` (force Required) → `false` (force Not required) → `null`, with optimistic UI + Supabase write. A header **RSA filter** (All / Required only / Not required only, default All) filters both tabs by effective RSA. **Manual re-finalize**: reopened rows expose a `CheckCircle2` icon next to the lifecycle badge (Finalized tab) and a "Mark as finalized" button in the detail sheet. Both call `markAsFinalized(t)` which writes `lifecycle_status='finalized'` (guarded by `eq("lifecycle_status","reopened_after_finalize")`) and patches local state optimistically. `reopen_count` and `last_reopened_at` are preserved as an audit trail. No re-trigger guard — the next `sync-v3-closed` pass may flip the row back to `reopened_after_finalize` if Intercom shows newer activity, in which case the user re-clears.
  - `/analytics-v3` (`src/pages/AnalyticsV3.tsx`) — **Headline KPIs** (anchored on `finalized_at`, the internal close timestamp): **Tickets closed in period** = `lifecycle_status='finalized'` AND `finalized_at` in range; subline shows `X opened in same window` (created-in-range) for context — the old Finalized-only / Include-open toggle is removed (inbound volume lives in the Active backlog strip). **Average CSAT** with subline `X% response rate (n rated / m closed)` computed against the same closed-in-period set. **Median time to resolve** with `P90: …` subline gated on `n ≥ 10` (renders `P90: insufficient data (n < 10)` below the threshold so the card layout stays stable). Each KPI title has an info-icon tooltip explaining the definition / caveats. **Active backlog strip**: Open now, Reopened, Oldest open age, Opened in range — Open now/Reopened/Oldest read every non-finalized row regardless of date; Opened in range respects the date picker. **Opened vs Finalized over time**: daily recharts line of `intercom_created_at` vs `finalized_at` counts (rows pulled in a single OR-query covering created-in-range OR finalized-in-range). **Resolved by Enterprise Support Engineer**: compact table with inline bars counting tickets whose `finalized_at` falls in range, grouped by `admin_assignee_id` and rendered through `admin_owner_map` (Sam + everyone else). **Exclude RSA = false** toggle (default OFF) sits next to the date range; when on, a single upstream `filteredRows`/`filteredActiveRows` derivation drops `effectiveRsa(...).value === "not_required"` so every KPI, chart, and per-engineer count stays consistent, with a `N tickets hidden` caption. Range presets clamped to `CLEAN_DATA_START_DATE`. Median + P90 read pre-computed `time_to_resolve_s`.
  - Settings (`src/components/InboxV3SyncCard.tsx`) — shows latest job per kind (status, cursor, counters, last error), total v3 row count, and four buttons: **Catch up closed** (loops `sync-v3-closed` up to 10 iters until `fetched=0`), Run closed once, Run open refresh, Run gap scan.

- Sidebar: two new Beaker entries (`Inbox v3`, `Analytics v3`) added in `AppLayout`. v2 entries unchanged.

- Constants live in `src/pages/inbox-v3/constants.ts` (`CLEAN_DATA_START_ISO/DATE/LABEL`) and are duplicated for Deno in `supabase/functions/_shared/v3.ts` (Deno can't import from `src/`).

- Required Support Action (RSA): `intercom_tickets_v3.rsa_override boolean null` is the only RSA storage; derivation lives client-side in `src/pages/inbox-v3/rsa.ts`. `effectiveRsa({ tags, rsa_override })` resolves with priority **manual override → tag → default**: `rsa_override=true` → `required` (source `manual`); `rsa_override=false` → `not_required` (source `manual`); else if tags include `enterprise-fyi` or `enterprise-duplicate` (case-insensitive, in `RSA_FALSE_TAGS`) → `not_required` (source `tag`); otherwise `required` (source `default`). Sync functions never touch `rsa_override` — it's UI-set only. v2 keeps its own engagement chain; the two systems are independent.

- Out of scope at the time (deliberate non-goals): no edits to `inbox_v2_tickets`, `sync-inbox-v2`, `InboxV2.tsx`, `AnalyticsV2.tsx`, or any existing cron. (All of those were removed outright on 2 Sep 2026.) No engagement classification in v3 (RSA replaces that role). Reopens are flagged only — never re-finalize. No automatic v2→v3 cutover; both run in parallel until manually cut over.

### Transferred-out reconciliation — `reconcile-v3-open` (commits `c8c12fd`, `9392d4c`, `4a44cb0`, `a7b5537`)

**Problem ("phantom-open").** Tickets transferred OUT of the Enterprise Inbox — reassigned to another team and often resolved there — used to linger in v3 forever as `state='open'` with stale attributes and null severity. `sync-v3-open` searches by `team_assignee_id = enterprise inbox`, so a ticket that left the inbox is never seen again and is never re-checked. Those phantoms polluted the Active queue and the Customers unattributed queue, and would have false-alarmed any staleness/triage alert. Bounded population at the time of the fix: ~6–7 tickets.

**Lifecycle state.** `intercom_tickets_v3.lifecycle_status` gains `transferred_out`, plus columns `transferred_at` and `reassigned_team_id`. Such tickets are **auto-excluded from SLA** with no extra filtering, because `useSlaBatch` only loads `finalized` / `reopened_after_finalize` — a ticket another team resolved is not our resolution to own. They stay visible (own tab) but out of our numbers. `AnalyticsV3` active/open counts explicitly exclude `transferred_out`.

**Function.** `supabase/functions/reconcile-v3-open/index.ts`, cron `reconcile-v3-open-hourly` at `7 * * * *`.
1. **Truth set** — paginated Intercom search for ALL conversations with `team_assignee_id = enterpriseInboxId` AND `state ∈ {open, snoozed}`. Deliberately **no time window**: this is the authoritative "what is actually in our inbox right now" set, not a delta.
2. **Diff** — our rows with `lifecycle_status IN (open, reopened_after_finalize)` that are absent from the truth set are "departed".
3. **Per-ticket authoritative re-check** — each departed ticket gets its own `GET /conversations/{id}`. `team ≠ inbox` ⇒ `transferred_out` (+ `transferred_at`, `reassigned_team_id`); `closed`/resolved-ticket in our inbox ⇒ `finalizeConversation` catch-up; still ours + open ⇒ left alone (`still_open_edge`, pagination/snooze edge).
   - **Transfer takes precedence over close, deliberately** — if a ticket both moved teams and closed, the close belongs to the other team and must not be counted as our resolution. Known consequence: a transferred-then-closed ticket never gets finalized in v3.
4. **Safety** — if the truth-set search errors, the run **aborts with 502 and writes nothing**; and because every mark is backed by a per-ticket GET, even a partially-paginated truth set can't cause a mis-mark. One pass both cleans existing phantoms and prevents new ones.
5. **Observability** — writes an `integration_health` row per run (key `reconcile-v3-open`, cast at the call site; not yet in the `IntegrationKey` union or the `integration-health-alert` list, so no Slack alert yet). Response returns split counters `transferred_out` / `finalized_catchup` / `get_failed` / `update_failed` / `finalize_skipped` / `still_open_edge` plus a capped `samples` array — the split counters are what turned an opaque `skipped: 7` into a diagnosable failure.

**Surface.** `InboxV3` gains a **"Team Reassignment"** tab (count badge; expandable table: Subject · Intercom ID · Customer · Time-in-inbox · Reassigned-to · Transferred).

**Constraint-bug footnote.** The first migration added a `lifecycle_status` CHECK constraint but its `DROP CONSTRAINT IF EXISTS` used a *guessed* name, missing the real pre-existing `intercom_tickets_v3_lifecycle_chk`. The stale constraint survived and silently rejected every `transferred_out` write (all 7 departed rows came back as `update_failed`) until it was dropped in a follow-up migration. **Lesson: look up a constraint's real name (`pg_constraint`) before ALTER — never guess it.**

## v3 Customer resolution (Track A)

Attributes each `intercom_tickets_v3` ticket to a known **customer account** so support data can be sliced by customer. Intercom is read-only — all customer mapping lives in Lovable and nothing is written back.

### Data model

- **`v3_customer_accounts`** — canonical registry (`account_key` PK, `label`, `domains text[]`, `aliases text[]`, `tier`, `csm_owner`, `status`, `notes`). Admin-only writes via `has_role(auth.uid(),'admin')`; any authenticated user can read. Domain-collision guard trigger rejects a domain claimed by another account; domains are lower-cased and de-duplicated on save.
- **`v3_channel_account_map`** — Slack channel id → `account_key` (customer shared channels).
- **`v3_internal_channels`** — exclusion list of channels that must never resolve to a customer (seeded with `C0AJ1KPQ084` / `team-enterprise-support`).
- **`v3_workspace_customer_map`** — Lovable `workspace_id` → `account_key` (+`tier`), seeded manually/assisted. Rescues CSM-on-behalf tickets.
- **`v3_ticket_attributes`** + **`intercom_tickets_v3.custom_attributes` (jsonb mirror)** — every Intercom custom attribute, flattened at sync-time.
- **`v3_coverage_snapshots`** — daily per-method snapshot; powers the trend chart. Written by `v3_capture_coverage_snapshot()` under pg_cron.
- **`v3_channel_account_proposals`** — pending auto-suggested channel→account mappings (suggest-then-confirm; never auto-applied).
- **`v3_personal_email_domains`** — allowlist of consumer email providers (gmail.com, etc.).
- New columns on `intercom_tickets_v3`: `customer_resolution_method`, `customer_confidence`, `custom_attributes`, `slack_channel_id_detected`, `workspace_id_detected`, `project_uuid_detected` — alongside existing `customer_key/kind/source` and `customer_override_key/by/at/reason`. `customer_kind` and `customer_resolution_method` now include the disposition values `not_enterprise` (Rule 0), `prospect_personal` (Rule 0b), and `prospect_unmapped` / `enterprise_prospect` (Rule 4b) — see Resolver below.

### Signal extraction (sync-time, TypeScript)

- `supabase/functions/_shared/v3-signals.ts` extracts from a ticket's `raw_payload`:
  - **Slack channel id** — ONLY from the auto-generated bot `conversation_parts` note whose `external_id` starts with `slack-url-` (parses `/archives/<CHANNELID>`). Human/admin notes and any other Slack links are ignored — they usually point at internal troubleshooting channels.
  - **workspace_id** — first `workspace_[0-9a-z]{16,}` match across source body + every conversation part. Multiple distinct ids log a loud warning.
  - **project uuid** — first `lovable.dev/projects/<uuid>` match.
- `supabase/functions/_shared/v3-attributes.ts` flattens `raw_payload.custom_attributes` into `v3_ticket_attributes` + the jsonb mirror.
- Both run in every full-payload write path: `sync-v3-closed`, `sync-v3-open` (finalize/reopen/silent-nudge), `_shared/v3-finalize.ts`. Standalone backfills: `backfill-v3-signals`, `backfill-v3-ticket-attributes`.

### Resolver — LOCKSTEP contract

Resolution order (first match wins), over the `*_detected` columns + `tags` + lookup tables only — no `raw_payload` parsing in SQL:

0. **population gate (`not-enterprise`)** — if `tags` contain `enterprise-not-enterprise`, resolve to `customer_key/kind/method = 'not_enterprise'` (confidence `high`). Evaluated ABOVE override so an out-of-scope ticket is excluded even if an override was set. _Why:_ whether a ticket is Enterprise work is a *population* question, separate from *which customer* it is. It's driven by a ticket tag (not an account field) because enterprise-ness is temporal — a ticket reflects the customer's status at its moment. Because the gate reads the live tag, removing the label re-derives the ticket normally on the next write/sync (future-proof if the company later upgrades/returns to Enterprise).
0b. **personal-account prospect gate (`prospect_personal`)** — if `tags` contain `enterprise-prospect-personal-acct`, resolve to `customer_key/kind/method = 'prospect_personal'` (confidence `high`). Evaluated ABOVE override, all account rules, and the plain `enterprise-prospect` tag — only Rule 0 outranks it. _Why:_ an individual (personal email) inquiring about Enterprise; personal emails are blocked from enterprise signup so this contact can NEVER become an Enterprise account. Placed above override + account rules so the disposition trumps any accidental attribution and takes priority over the softer `enterprise-prospect` fallback. Counted separately, excluded from the SLA population, kept out of the Unattributed queue — an explicit, visible category, never silently hidden.
1. **override** — `customer_override_key` set → `high` confidence, method `override`. Top authority among *which customer* rules; never overwritten by rules 2–5.
2. **slack_channel** — `slack_channel_id_detected` present, NOT in `v3_internal_channels`, found in `v3_channel_account_map` → `high`, method `slack_channel`.
3. **domain** — contact email domain matches `v3_customer_accounts.domains`, excluding `lovable.dev` and any `v3_personal_email_domains` entry → `high`, method `domain`.
4. **workspace_id** — `workspace_id_detected` found in `v3_workspace_customer_map` → `medium`, method `workspace_id` (best guess, confirmable).
4b. **unmapped-prospect fallback (`enterprise-prospect`)** — if `tags` contain `enterprise-prospect`, resolve to `customer_key/kind = 'prospect_unmapped'`, method `enterprise_prospect` (confidence `medium`). Placed BELOW all account rules so a converted prospect (real account or mapped workspace) resolves to that account first and this rule never fires (verified: 5 of 9 `enterprise-prospect`-tagged tickets already resolved to an account above this rule). No registry record is created. Counted as prospect load, excluded from the SLA population, kept out of the Unattributed queue.
5. otherwise → `customer_key='unattributed'`, method `unresolved`.

_Why prospects don't create registry rows:_ this is a trouble-ticket reporting tool, not a CRM. We deliberately do NOT track pre-sales history and do NOT create registry records for speculative prospects — observed conversion is negligible, and per-company history already lives upstream in Intercom (the source of truth). Both prospect dispositions are COUNTED but excluded from the SLA population — always as explicit, visible categories, never a silent hide.

Three implementations MUST stay in lockstep — edit all of them when rules change:

- SQL `public.v3_derive_customer` (authoritative; called by BEFORE INSERT/UPDATE trigger `intercom_tickets_v3_apply_customer`). Signature is `(_contact_email, _override_key, _contact_domain, _slack_channel_id_detected, _workspace_id_detected, _tags text[])` — 6 args. The old 5-arg and 2-arg overloads were dropped; a single canonical function remains.
- Propagate triggers: `v3_customer_accounts_propagate`, `v3_channel_account_map_propagate`, `v3_internal_channels_propagate`, `v3_workspace_customer_map_propagate` — bump `updated_at` on affected tickets, which re-fires the derive trigger. Result: mapping a channel/domain/workspace once retroactively re-attributes all matching existing tickets AND all future ones.
- Deno `supabase/functions/_shared/v3-customer.ts` (`resolveV3Customer()` — thin wrapper over the SQL function for sync-time convenience/logging; the DB trigger is still authoritative on every write).

Tag propagation: the BEFORE trigger `intercom_tickets_v3_apply_customer` passes `NEW.tags`; `backfill_v3_customer_keys` passes each ticket's tags; the Deno wrapper passes `_tags`. All lockstep components updated together.

`backfill_v3_customer_keys(_force boolean, _batch integer)` re-derives existing rows in 5k batches; pass `force=true` after any rule/allowlist change (else only NULLs are filled).

### Verified coverage

"Attributed" counts only tickets resolved to a known registry account. Manually-entered `customer_override_key` values that don't match any registered account are **orphans** — surfaced separately for reconciliation, NOT counted as clean attribution (keeps the metric honest). `v3_coverage_current()` returns live numbers; `v3_capture_coverage_snapshot()` runs daily under pg_cron into `v3_coverage_snapshots` for the trend chart.

**Population gate in coverage:** `v3_coverage_current()` returns the disposition counters `excluded_not_enterprise` (Rule 0), `excluded_prospect_personal` (Rule 0b), and `excluded_prospect_unmapped` (Rule 4b) plus `population` (= `total_tickets − excluded_not_enterprise − excluded_prospect_personal − excluded_prospect_unmapped`). `pct_attributed` is computed over `population` (in-scope tickets), NOT over `total_tickets`. `v3_coverage_snapshots` gained matching columns (`excluded_not_enterprise`, `excluded_prospect_personal`, `excluded_prospect_unmapped`), persisted by `v3_capture_coverage_snapshot()`. _Why:_ excluding out-of-scope + prospect tickets from the denominator keeps coverage honest — an assist to a non-Enterprise party or a pre-sales inquiry shouldn't count for or against Enterprise-customer attribution. Every excluded count is shown as its own KPI, never silently dropped.

**Coverage is served from a cache, not recomputed per view (2 Sep 2026).** `v3_coverage_current()` was the single most expensive statement in the database (~2.3s mean, ~7.3s max, 249 calls) because the Customers page called it live on every render. `public.v3_coverage_cached(max_age_minutes)` now returns the persisted snapshot and recomputes at most **hourly**; the Customers **Coverage** and **Unattributed** tabs read it instead of `v3_coverage_current()`. The live function is untouched and still available for on-demand truth. _Trade-off, stated plainly:_ coverage numbers can lag reality by up to an hour — accepted because attribution moves in days, not minutes.

**Coverage RPC narrowing (migration `0034`, 4 Sep 2026).** `v3_coverage_current()` no longer materialises wide `intercom_tickets_v3` rows (it was pulling `raw_payload` into every scan); it selects only the columns the counters need and computes registry membership once. `v3_unattributed_groups()` likewise precomputes its classification/probe expressions once instead of per-branch. Grants preserved; output equivalence checked against the previous definitions. Measured after: coverage ~74ms vs a ~2.28s historical mean. _UNVERIFIED:_ unattributed-group equivalence at scale — only 3 unattributed rows exist today.

### UI — `/customers` (`src/pages/Customers.tsx`), 4 tabs

- **Coverage** — % verified-attributed KPI (denominator = in-scope `population`, shown as "N of {population} in-scope tickets"). Three disposition KPI cards: **"Non-Enterprise (excluded)"**, **"Individual inquiries (personal)"** (`excluded_prospect_personal`), and **"Prospects (unmapped)"** (`excluded_prospect_unmapped`), each with a tooltip explaining the rule that gated it. Method distribution (override / slack_channel / domain / workspace_id / unresolved), orphan count, trend chart from `v3_coverage_snapshots`.
- **Unattributed** — queue of tickets still `customer_key='unattributed'`, grouped via `v3_unattributed_groups` by reclaim signal: **domain** (with a mapped-account suggestion), **channel** (unmapped Slack channel), **workspace** (detected workspace_id), **personal_unlabeled** ("Likely personal — needs label"), and **no_signal** (residual, no reclaim hook). Prospect + not-enterprise dispositions are NOT in this queue — they resolved out at the resolver. Group counts and expanded rows come from the SAME server RPCs (`v3_unattributed_groups` for counts; `v3_personal_unlabeled_tickets` for `personal_unlabeled` rows; `v3_no_signal_tickets` for `no_signal` rows) so count == rows by construction — the fix pattern from the earlier no_signal count/rows drift; never re-derive client-side.
- **Transferred-out exclusion from the worked-list** (commit `bc8ceae`) — the queue now filters out `lifecycle_status = 'transferred_out'`. Applied consistently across all four RPCs feeding the tab: `v3_unattributed_groups()`, `v3_no_signal_tickets()`, `v3_personal_unlabeled_tickets()` and `v3_unattributed_sync_status()` (**both** its `pending_open` and `pending_closed` counts), plus the domain/channel/workspace drill query in `Customers.tsx` (`.neq("lifecycle_status","transferred_out")`) — so the group counts still equal the expanded rows and the count == rows single-source-of-truth invariant is preserved. _Why:_ a ticket transferred OUT of the Enterprise Inbox has been handed off to another team and is already surfaced in the InboxV3 **"Team Reassignment"** tab. It is never re-fetched again (it left the inbox), so its `tags` / `customer_key` are **frozen** — it can NEVER heal via the open-ticket tag refresh, and previously sat in the attribution worked-list forever as a phantom. This is a **re-home, not a silent drop**. Bonus: those frozen phantoms also stop being counted as "pending full-fetch" forever in the amber sync-status banner. _Deliberate scope boundary:_ only `transferred_out` is excluded — `open` and `finalized` unattributed tickets **stay**, because a closed-but-unattributed ticket is still a fixable data-quality item and hiding it would violate the surface-loudly rule. _Known divergence (intentional, pending a separate decision):_ the Coverage tab's functions (`v3_coverage_current`, `v3_capture_coverage_snapshot`, …) were NOT changed, so they still count transferred-out tickets as unattributed — Coverage and the Unattributed worked-list can now differ by that count. Flagged, not yet decided.
- Coverage stat on the Unattributed tab: **"Personal inquiries labeled: N of M (P%)"** where N = `prospect_personal` count (from `v3_coverage_current`) and M = N + the `personal_unlabeled` group size. _Why:_ personal-email tickets that are still `unattributed` (i.e. NOT yet labeled `enterprise-prospect-personal-acct`) must not silently hide inside `no_signal`. Peeling them into their own group + a coverage KPI keeps a forgotten label LOUD (explicit unresolved state) — the surface-loudly principle. Intended action is applying the label in Intercom (source of truth); no in-app override flow, since each is an individual.
- **Tag-sync-lag surfacing on the Unattributed tab** — amber banner + per-row badge that make tag-blind tickets explicit. Backed by read-only RPC `v3_unattributed_sync_status()` returning `pending_open`, `pending_closed`, `next_full_fetch_at`, `schedule_desc` (computed from the `sync-v3-closed-frequent` cron schedule in `cron.job`). `v3_no_signal_tickets()` and `v3_personal_unlabeled_tickets()` were extended to return `last_full_fetch_at` so the per-row "tags pending sync" badge can light up on any expanded ticket where it's `NULL`. The banner shows two lines when non-zero: open — "N open ticket(s) with tags not yet synced — Intercom labels pull when the ticket closes, so their disposition stays unconfirmed until then" (no clock); closed — "N closed ticket(s) awaiting the next full fetch (~HH:MM UTC, every 15 min)". _Why (the non-obvious system characteristic):_ Intercom tags/labels only populate on a FULL conversation fetch, which is written by `sync-v3-closed` (on close/finalize) — NOT by the light list-sync that ingests new tickets. **OPEN tickets are therefore TAG-BLIND until they close**: tag-driven dispositions (`enterprise-not-enterprise`, `enterprise-prospect-personal-acct`, `enterprise-prospect`) are invisible to the resolver while the ticket is open, so a tagged-but-open ticket can sit in the queue looking like a settled `unattributed` when its disposition is really unknown-until-close. This is acceptable for SLA reporting (population = finalized tickets), but the queue must not present it as settled. The banner splits open vs closed on purpose: the `*/15-min` cadence only re-fetches CLOSED tickets, so the "next full fetch at HH:MM" clock is only honest for the closed line — open ones wait for close, no cron promise applies. Same surface-loudly principle: never let a sync lag masquerade as a real disposition.
- **Channels** — channel list (`v3_channels_usage`) with human-readable names + mapped/internal/unmapped status; auto-suggested mappings from `v3_channel_account_proposals` (high = domain co-occurrence, medium = name-token match on the registrable domain label — token strip list excludes `ext/external/lovable/admin/customer/support/help/team/proj/project/account`). Actions: Map / Mark internal / Confirm / Edit / Reject.
- **Registry** — CRUD on `v3_customer_accounts` (+ workspace cache and internal channels); orphan-override reconciliation with fuzzy-match suggestions from `v3_orphan_override_suggestions`. Includes a client-side search box (label / domains / aliases / account_key). Accounts also carry an **`is_test boolean` (default `false`)** column — marking an account as test flips its tickets into the `test_account` SLA exclusion (see Track B). Currently set on `let_it_fly_test_account` (the Let-it-Fly sandbox).
- **Single editor for `v3_customer_accounts` (7 Aug 2026)** — the Registry is now the ONLY place customer accounts are created/edited. Settings previously carried a second editor (`CustomerAccountsCard`) writing the SAME table — never a mirror or a duplicate data set, just a second, narrower editor. It exposed only `account_key / label / domains / notes`, so accounts created there landed with no `status`, `tier` or `aliases` — half-populated registry rows the resolver and Coverage tab then had to explain. Settings now renders a one-line pointer card linking to `/customers?tab=registry` (the Customers page reads a `tab` query param, defaulting to `coverage`, so the deep link opens straight on Registry). `src/components/CustomerAccountsCard.tsx` is deliberately KEPT on disk, unrendered and with no importer, as an instant rollback path — same additive/reversible pattern used when the breach + triage override tables were consolidated. No schema, resolver, RLS or data change; both surfaces always pointed at one table.
- Rows on Channels / suggestions / orphan panel **expand** to show the underlying tickets via `v3_tickets_for_channel` / `v3_tickets_for_override_key`, each with a deep link to Intercom for verification. Read-only disclosure — no per-ticket actions in the drill-down.

**Permissions:** per-ticket override (writing `customer_override_key`) is open to any authenticated user. All structural registry writes — account create/edit, channel map, internal-channel mark, workspace seed, proposal generation and confirm/reject — are admin-only.

### Key RPCs / views

`v3_derive_customer`, `v3_coverage_current`, `v3_capture_coverage_snapshot`, `v3_unattributed_groups`, `v3_unattributed_sync_status`, `v3_no_signal_tickets`, `v3_personal_unlabeled_tickets`, `v3_channels_usage`, `v3_accounts_usage`, `v3_orphan_overrides`, `v3_orphan_override_suggestions`, `v3_generate_channel_proposals`, `v3_channel_proposals_pending`, `v3_tickets_for_channel`, `v3_tickets_for_override_key`, `backfill_v3_customer_keys`.

### Design principles

- **Surface problems loudly, never silently default** — unresolved tickets go to a visible queue and a coverage KPI, never a guessed bucket. Same principle drives the `personal_unlabeled` split out of `no_signal` and the two new prospect disposition KPIs.
- **Single-source-of-truth on the wire** — a group's count and its expanded rows use the IDENTICAL server-side predicate (RPCs), never a re-derivation on the client. Prevents the count/rows drift class of bug.
- **Human signals are advisory; stored attribution is system-derived** — a bad manual entry can only fail to match (→ queue), never corrupt data.
- **This is a support-reporting tool, not a CRM** — no registry rows are created for speculative prospects; per-company history stays in Intercom (source of truth). We count prospect volume as its own explicit category and move on.
- **Ticket-status taxonomy (carried on the ticket via read-only Intercom tags — status is temporal, so it rides on the ticket rather than a mutable account field):**
  - **not-enterprise** — never an Enterprise customer / out of scope (e.g. a Support Engineer assisting a non-Enterprise party) → `enterprise-not-enterprise` tag → Resolver Rule 0 → excluded from the population.
  - **prospect_personal** — individual (personal email) inquiring about Enterprise; can never become an Enterprise account → `enterprise-prospect-personal-acct` tag → Resolver Rule 0b → excluded from the population, no registry record.
  - **prospect (unmapped)** — pre-sales inbound (pricing, security, exploring upgrade) with no account match → `enterprise-prospect` tag → Resolver Rule 4b (soft fallback, only fires when no account signal resolves first) → excluded from the population, no registry record. Once the prospect converts and gets a real account or mapped workspace, account rules win and this rule silently stops applying.
  - **customer (incl. former)** — is or was a real Enterprise customer, even briefly (e.g. a churned/torn-down account) → plain registry account, no tag → attributed and counted.

### Auto-registration from Slack #closed-won

New customer accounts are seeded automatically from the Slack "closed-won" channel so the registry stays current without manual entry.

- **Function:** `poll-slack-closed-won` (edge function, `verify_jwt = false`).
- **Schedule:** `pg_cron` job `poll-slack-closed-won-daily`, `0 4 * * *` (daily at 04:00 UTC).
- **Source:** Slack channel `C09CL5E028N`, read via the "11 - PICK THIS BOT CONNECTION" bot token (`SLACK_API_KEY_1`) through the connector gateway `conversations.history`.
- **Window:** every run scans messages with `ts >= now − 7 days` (widened from 2 days on 27 Jul 2026). Dedup makes a wide window free, and it catches late-posted/late-edited announcements that a 2-day window missed (e.g. Collinson).
- **Extraction:** per message text, pulls the value after `Company Name:` and `Company Domain:` (markdown stripped, domain lower-cased). Both captures use `[ \t]*`, **not** `\s*` — `\s*` crosses newlines, so an empty `Company Domain:` line silently captured the *next* line's leading emoji shortcode (AARP's blank domain captured `:page_facing_up:` from the following `Deal Name:` line, and was then reported as a malformed domain). Fixed 27 Jul 2026.
- **`account_key` derivation:** company name → lowercase → spaces to `_` → strip non-alphanumerics.
- **Dedup:** skips candidates whose `domain` is already present in any `v3_customer_accounts.domains` array (via `.overlaps`) OR whose `account_key` already exists. Also dedupes within the batch.
- **Malformed-domain guard:** a non-empty extracted domain must match a registrable-domain shape (labels + alpha TLD ≥ 2). Anything else is **never inserted** — it is listed in the response `malformed[]`, logged, and marks the run unhealthy. Previously such junk would have been silently written as an account.
- **Missing-domain bucket:** when HubSpot posts the deal with an empty `Company Domain:` value (AARP), the company is reported in `missing_domain[]` with a "add the account manually" health note. It is never inserted (no domain = nothing to dedupe or attribute on) and it is kept distinct from `malformed[]` so the health message names the real problem — the source record is incomplete, not the parser.
- **Missing-domain acknowledgement (27 Jul 2026):** a blank domain is only a problem while the account is *absent* from the registry. Before health is written, each blank-domain company's derived `account_key` is looked up in `v3_customer_accounts`; if it exists (added by hand, with or without domains) it moves to `missing_domain_handled[]` and no longer marks the run unhealthy. Without this the health card stayed red forever on an already-handled row — an alert that can never clear is noise, not signal. AARP was added manually with `domains = {}` (attributable only via Slack channel map or override until a domain exists).
- **Explicit dismissal (8 Sep 2026):** the registry lookup above only clears the alert when the Slack company name slugifies to an *exact* `account_key`. Real registries split a company across keys (Slack "Cars Commerce" → `cars_commerce`, registry holds `cars_commerce_us` and `cars_commerce_canada`), so the alert could not clear without inventing a third, attribution-affecting registry row. Second clearing path: `public.v3_closed_won_acknowledged_names` (`name_key` PK = same slug, `display_name`, `note`, `acknowledged_by`/`_email`, `acknowledged_at`; RLS = authenticated read, `can_edit()` insert/delete). The poller unions acknowledged `name_key`s into the handled set, so an acknowledged company lands in `missing_domain_handled[]`. Deliberately a *separate* table, not an alias column on `v3_customer_accounts` — acknowledging an alert must never change customer attribution. UI: Settings → Integration health, the closed-won row parses the health message's `blank Company Domain for "<name>"` phrase and renders a per-company **Dismiss** button that inserts the acknowledgement and immediately re-runs the poller, so the card recomputes from a real run instead of being cleared cosmetically. VERIFIED 8 Sep 2026: with `cars_commerce` acknowledged, a server-side cron-header invoke flipped `integration_health.slack_closed_won_poll` from `error` / `consecutive_failures 4` to `ok` / `0`. UNVERIFIED: the Dismiss button itself has not been clicked in the browser (backend path exercised directly).
- **Insert shape:** `{ account_key, label: <company name>, domains: [<domain>], notes: 'Auto-created from Slack #closed-won on <date>' }`. All other columns default.
- **Idempotent:** re-running the same day is a no-op because dedup fires on both keys.
- **Diagnostics:** optional POST body `{ lookbackDays?: number (1–365), dryRun?: boolean }`. `dryRun` reports `would_insert[]` and writes nothing (and skips health recording). Responses always include `scanned`, `extracted`, `inserted`, `skipped_*`, `unparsed[]`, `malformed[]`, `missing_domain[]`, `missing_domain_handled[]`, `errors[]`.
- **No silent failures:** every non-dry run records `integration_health.slack_closed_won_poll` — `ok` only when there were zero insert errors, zero malformed domains, and zero *unhandled* missing domains; `auth_error` on Slack 401/403; `error` on Slack API/non-JSON gateway responses, insert failures, malformed or unhandled-missing domains, or a fatal exception. Surfaced in Settings → Integration health (36h staleness window, i.e. one missed daily run) and alerted to `#enterprise-support-hub-alerts` by `integration-health-alert`.

### Parahelp routing queue (step 2 of the closed-won chain)

Registering the account is only half the job: mail from that domain to `enterprise-support@lovable.dev` also has to be routed into the Enterprise inbox in Parahelp. That second step is tracked as its own queue, deliberately decoupled from the registry writer.

- **Table:** `public.parahelp_routing_sync` — one row per domain (`domain` UNIQUE), with `account_key`, `source`, `state` (`pending | pushed | manual_done | failed | skipped`), `attempts`, `last_error`, `pushed_at`, `completed_by`, `completed_at`, `note`. RLS: any authenticated user reads; only admins write; `service_role` full.
- **Enqueue:** `AFTER INSERT OR UPDATE` trigger `parahelp_enqueue_new_domains_trg` on `v3_customer_accounts` inserts any *newly added* domain with `ON CONFLICT (domain) DO NOTHING`. This is why `poll-slack-closed-won` needed **no code change** — and why manual registry adds and backfills feed the same queue.
- **Non-blocking by design:** the trigger is AFTER and conflict-tolerant, and the push worker never writes `v3_customer_accounts` and never runs inside the poller. A Parahelp outage can only leave rows `pending`; it can never block or corrupt a registry update.
- **Seed (13 Aug 2026):** all 490 domains already in the registry at queue creation were inserted as `skipped` ("Pre-existing registry domain at queue creation"), so the queue starts clean and only tracks new arrivals.
- **Push worker:** `sync-parahelp-routing` (edge function), `pg_cron` job `sync-parahelp-routing-daily` at `30 4 * * *` — half an hour after the poller. Reads up to 50 `pending`/`failed` rows with `attempts < 5`, oldest first.
- **API leg is DORMANT.** There is no Parahelp connector in Lovable's catalog and no confirmed Parahelp routing endpoint. The push activates only when **both** `PARAHELP_API_KEY` and `PARAHELP_ROUTING_URL` secrets exist; the request shape in `pushDomain()` is a placeholder to be corrected once Parahelp confirms the endpoint. Enabling it is a change to that one function — no schema or UI work.
- **Slack digest:** every non-dry, non-silent run posts the pending-domain list to `#enterprise-support-tickets` (`C0BPDU4JH71`, overridable via `NEW_TICKET_ALERT_CHANNEL`), stating whether the automatic push is on. Nothing sits silently pending.
- **Health:** `integration_health.parahelp_routing_sync`. A dormant API leg is **not** a failure — pending rows are the expected steady state until credentials exist. Only real push failures (API leg on) or a queue-read/fatal error mark the run unhealthy.
- **UI:** Admin → Customers → **Parahelp routing** tab (`src/components/customers/ParahelpRoutingTab.tsx`). Open rows oldest-first with age, account, state, last error; admin-only **Mark as routed** (records `completed_by` = user email) and **retry** on failed rows. Completed rows collapse into a second card. This is the working queue while the API path is unavailable.
- **Diagnostics:** POST `{ dryRun?: boolean, silent?: boolean }` — `dryRun` writes nothing and skips health; `silent` suppresses the Slack digest.

### Notion domain page (step 3 — the actual Parahelp hand-off, 13 Aug 2026)

Parahelp confirmed they have **no routing API**. Their enterprise domain list lives in the agent's own memory file (`base.md`) and every edit goes through their human-approval queue. What their agent *can* do is read a Notion page on a schedule or page-change trigger, diff it against its memory, and draft the edit for approval. So the real hand-off is a Notion page the Hub keeps in sync — the `parahelp_routing_sync` queue above stays as the manual working list, and its API leg is now known to be dead-on-arrival.

- **Function:** `publish-registry-notion`. Reads `v3_customer_accounts`, renders a `Domain | Account | Tier` table (one row per domain, sorted) preceded by a provenance line, and writes it to a Notion page through the connector gateway (`connector-gateway.lovable.dev/notion/v1`, `LOVABLE_API_KEY` + `NOTION_API_KEY`).
- **Exclusion is exactly one rule:** `status = 'prospect'` accounts are dropped (unsigned — their mail must not route to the Enterprise inbox). **Test accounts and `inactive` accounts ARE published**, by explicit decision (Matt, 13 Aug). Domains are lower-cased and de-duplicated; `aliases` are not published (account-name variants, not mail domains).
- **Idempotent:** the rendered row set is SHA-256 hashed and compared with `settings.notion_registry_hash`. Unchanged ⇒ **no Notion request at all**, so Parahelp's page-change trigger only fires on a real domain change. `{ force: true }` overrides.
- **Full rewrite, never a partial diff:** on change, every existing child block on the page is deleted and the table re-appended (Notion caps children at 100/request, so rows go in chunks of 90). The page therefore cannot drift from the registry, and removals propagate. Approving a removal on Parahelp's side is their process, not ours.
- **Settings:** `settings.notion_registry_page_id` (id or URL, normalized to a dashed uuid — never hardcoded), plus `notion_registry_hash`, `notion_registry_synced_at`, `notion_registry_changed_at`, `notion_registry_domain_count`. Target page: *Enterprise Support Hub Domains* (`3bbe969ca5a280d298f3c0c43e51cf87`).
- **UI:** Admin → Customers → Parahelp routing → **Notion domain page** card — domains on page, last sync, last change written, editable page id, **Dry run** and **Sync to Notion** (admin-only).
- **Health:** `integration_health.notion_registry_publish` (36h window); Notion 401/403 records `auth_error`.
- **Diagnostics:** POST `{ dryRun?: boolean, force?: boolean }` — `dryRun` renders, reports the change verdict and a 10-row sample, and writes nothing.
- **BLOCKED (13 Aug 2026):** the Notion connection is not yet linked to this project — Matt needs workspace permission to add the connector. Until then `NOTION_API_KEY` is absent and the function fails fast with that message. The daily `pg_cron` schedule (05:00 UTC, after the 04:00 poller and 04:30 routing worker) is **deliberately not created yet** so a missing credential does not alarm daily; it goes in with the first successful write.



---

## Track B — SLA measurement & validation tool (v3)

### Purpose

Measure the current shape of enterprise support SLAs (first response, resolution, reopen, handling time) AND evaluate them against **provisional** per-severity compliance targets. A per-ticket **validation** tool was built first so every metric definition can be spot-checked against a live Intercom conversation before any aggregate reporting is trusted. Targets are unratified — the compliance stack is reusable plumbing that feeds a future dashboard/slider; `SLA_TARGETS` is the single source of truth and can be edited in one place.

**Why we can't just use Intercom's stats:** Intercom's `time_to_admin_reply` / SLA status materially miscount tickets where a Lovable teammate replied in Slack — Intercom mirrors that reply into the conversation as `author.type === "user"` under a contact id, so its FRT clock never stops. We've seen this inflate first-response to hours/days and mis-mark SLAs "missed" on real tickets (e.g. a Checkr ticket where Intercom showed ~35 h + "missed" vs true ~8 h; a Frontlineed ticket where a CSM's reply Intercom dropped entirely). The engine below recovers the true first human/agent response by classifying actors ourselves.

### The big shift: unified clock-start at Enterprise Inbox assignment

All Enterprise SLA timers — First Response AND Resolution — start at **`slaClockStartS`**, defined in `src/lib/slaMetrics.ts` as the ts of the **first assignment to the Enterprise Inbox team** (`ENTERPRISE_INBOX_TEAM_ID = "8484447"`), falling back to `created_at` when a ticket never hit the inbox.

**Why:** the Enterprise SLA clock should start when a ticket becomes the Enterprise team's responsibility. Everything before that — intake / routing, Sam's AI handling window, pre-ticket Slack / CSM chatter — is **PRE-ENTERPRISE** and is not counted against SLA. This gives us **one rule for three ticket families**:

- **Email / direct** — inbox assignment ≈ ticket creation; timers start ~at creation.
- **Sam-first** — Sam handles first, then hands off to a human; the handoff *is* the inbox assignment, so timers start at Sam→human, and Sam's own handling is excluded (readable separately as pre-inbox time).
- **Slack-native** — a Slack thread that later gets ticketized; timers start at ticketization (= inbox assignment), pre-ticket Slack chatter excluded.
- **Manually-logged bulk-import** — excluded entirely (see below).

This **replaces** the previous "FRT from AI→human handoff (escalation) else from open" branching. The old fields (`firstHumanReplyFromEscalation*`, `firstHumanReplyFromOpen*`) and `escalationBasis` / `escalationTs` are **retained on `SlaResult` for back-compat and for the live-Analyze display strip only** — `evaluateCompliance` does not use them.

### Engine — `src/lib/slaMetrics.ts`

Pure, source-agnostic TypeScript. No network, DB, or Intercom client access. Same shape input for live-fetched conversations and stored `raw_payload` — `computeSla(conversation)` is the single source of truth for every metric.

**Actor model** (`Actor = customer | human_admin | sam_ai | operator_bot | system | shared_inbox`, `classifyActor`):

- **Sam (AI agent)** is identified by `author.id === "9520895"` (`SAM_AUTHOR_IDS`) or `author.email === "lovable@parahelp.com"` (`SAM_AUTHOR_EMAILS`) — **NOT** by Intercom's `from_ai_agent` / `is_ai_answer` / `ai_agent_participated` flags. Sam runs via Parahelp and posts through Intercom as a regular admin, so those flags are all FALSE for Sam's parts.
- **Shared relay inbox (`shared_inbox`, B6 fix)** — a Lovable **shared RELAY mailbox** (currently only `enterprise-support@lovable.dev`) that forwards a **customer's** message into a thread under an `@lovable.dev` address. Detected via the explicit `SHARED_MAILBOX_EMAILS` allowlist, checked **after** the Sam check and **before** the `@lovable.dev → human_admin` rule. **Bug it fixes:** the domain shortcut used to brand these relayed customer messages as OUR reply, which stopped the resolution clock early (flattering numbers) and would have falsely satisfied the upcoming cadence metric. **Behavior — customer-SIDE everywhere, never our agent reply:** returns the ball to us in `computeResolutionActive`; counts as customer presence in `noCustomerParticipant` (a relay-only-customer thread is NOT flagged no-customer); opens/closes customer-wait gaps in handling time; maps to legacy author type `"user"`; `initiatedBy` resolves to `"customer"` for a relayed source. It is **not** matched by any agent/reply predicate (`firstHumanReply` / `firstSupportReply` / escalation / `noHumanReply`). **Why (Intercom is source of truth):** Intercom itself types these parts as `user` (contact/customer-side) and sets `waiting_since` on them — confirmed live on ticket 215475248028246 (AT&T), where the relayed part is the customer (Anthony Spaulding) and a human replied 21 min later; our reply cleared `waiting_since` (ball → customer). **Allowlist deliberately NOT broadened:** an enumeration of every `@lovable.dev` part-author across v3 confirmed `enterprise-support@` is the ONLY shared relay (highest ticket fan-out; types lead/user, never admin); every other `@lovable.dev` author is a real teammate (CSMs' Slack replies mirror in as `type=user`), so a broader key (e.g. "not in the teammates roster") would misclassify real people. This is the clean foundation the upcoming communication-cadence metric builds on.
- **Lovable teammates** are identified by the `@lovable.dev` email domain (`TEAMMATE_EMAIL_DOMAIN`). Critical: a teammate's Slack reply mirrors into Intercom as `author.type === "user"` under a contact id — the email domain check overrides the type and classifies them as `human_admin`. Safe because `@lovable.dev` is internal-only (and the shared-relay allowlist runs first).
- Fallbacks: `type==="bot"` → `operator_bot`; `type==="admin"` → `human_admin`; `type ∈ {user, lead, contact}` → `customer`; else `system`.

**Public reply** (`isPublicReplyPart`): `part_type === "comment"` OR (`part_type === "assignment"` with non-empty body). Mirrors the forwardable-part logic in `intercom-webhook`. Notes and pure state/assignment events are NOT public replies.

**Timeline** (`extractTimeline`): the opening `source` message plus every entry in `raw.conversation_parts.conversation_parts`, sorted by `ts`, each with classified `actor`, stripped body, assignment target, `isPublicReply`, `isNote`.

**Business hours** — **Europe/Berlin, DST-aware, Mon–Fri 09:00–24:00** (constants `BUSINESS_HOURS_TIMEZONE`, `BUSINESS_HOURS_START_HOUR=9`, `BUSINESS_HOURS_END_HOUR=24`; `BUSINESS_DAY_SECONDS = (END − START) × 3600 = 15 × 3600`, derived — edit the window constants and the day auto-adjusts). Implemented via `Intl.DateTimeFormat`; `businessHoursBetween(startSec, endSec)` walks day-by-day and DST-corrects each window boundary. Company holidays are **not yet modeled** — accepted limitation.

**Multi-clock metrics** — every clock has a **calendar** and **business-hours** variant in `SlaResult`:

| Clock | Field (calendar) | Field (BH) |
|---|---|---|
| **First human reply from inbox anchor** (used by compliance) | `firstHumanReplyFromInboxS` | `firstHumanReplyFromInboxBusinessHoursS` |
| **Resolution — active in-our-court, from anchor** (stop-the-clock, used by compliance) | `resolutionActiveS` | `resolutionActiveBusinessHoursS` |
| Pre-inbox time (process signal, NOT an SLA) | `preInboxTimeS` | — |
| First response any-agent (incl. Sam) from open | `firstResponseAnyAgentS` | `firstResponseAnyAgentBusinessHoursS` |
| Time-to-escalation from open (reference) | `timeToEscalationS` | `timeToEscalationBusinessHoursS` |
| First human reply from escalation (back-compat) | `firstHumanReplyFromEscalationS` | `firstHumanReplyFromEscalationBusinessHoursS` |
| First human reply from open (back-compat) | `firstHumanReplyFromOpenS` | `firstHumanReplyFromOpenBusinessHoursS` |
| Raw TTR (reference only) | `ttrS` (from Intercom `statistics.time_to_last_close`) | `ttrBusinessHoursS` |
| Handling time (customer-wait sum) | `handlingTimeS` | `handlingTimeBusinessHoursS` |
| Reopen count | `reopenCount` | — |

**First Response — SUPPORT-based and clamped** (`firstSupportReplyFromInboxS` / `firstSupportReplyFromInboxBusinessHoursS`) — commit `1752ca6`:

- **A** = ts of the **first PUBLIC reply anywhere in the thread by a teammate on the SUPPORT roster** (`public.teammates WHERE role='support'`), matched by **email OR `intercom_admin_id`**. **B** = `slaClockStartS` (the Enterprise Inbox anchor). **`FRT = max(0, A − B)`**.
- **Sam is `role='ai'`** → never on the roster → correctly excluded, no special-casing needed.
- **No support reply at all → `null`** (not-evaluable). A reply by a non-support admin does not stop the FR clock.
- _Why email **or** id:_ a support engineer's **Slack** reply mirrors into Intercom carrying only the **email** (no admin id), while an in-Intercom reply carries the **admin id**. Matching on both is the only way to catch every real first response — matching on either alone silently misses a whole channel.
- _Why clamped:_ support who answered **before** the ticket reached the Enterprise Inbox previously produced a negative/false breach. `max(0, …)` makes "we answered before the ticket existed" a **MET at 0** — the honest reading.
- **Roster is passed IN, engine stays pure:** `computeSla(payload, { supportEmails, supportAdminIds, supportSlackNames })`; `useSlaBatch` loads the roster from `teammates` and threads it through. **No-roster fallback:** if the roster query fails, both sets are empty and the engine falls back to the pre-commit behaviour (**any `human_admin` public reply**) rather than scoring nothing.
- **Slack relay attribution (Aug 2026):** a teammate replying **from Slack** is posted into Intercom under the **relay admin identity (Sam, admin id `9520895`)** with the body prefix `[From: <name> via Slack]` and **no teammate email or admin id** — so neither roster match fires and the reply used to read as `sam_ai`, leaving the FR clock running forever (observed on Handshake `215475637394716` and Tre `215475649809370`, both showing "no support reply" while Tine had in fact answered). Fix: `extractTimeline` parses the prefix into `TimelinePart.relayFrom` (lowercased, prefix-anchored so quoted mid-body text is ignored), and `computeSla` re-attributes that part to `human_admin` **only when the name is in `supportSlackNames`** — teammate full name, first name, or email local part, min 3 chars, built from `teammates WHERE role='support'`. An **unknown** relay name (the customer speaking in the shared Slack channel, e.g. `[From: Stan via Slack]`) is left exactly as before — no guessing. Re-attribution happens **before** any metric reads the timeline, so FRT, resolution-active, cadence and triage all see the teammate. **Known limitation:** a customer whose Slack display name collides with a teammate first name would be mis-attributed; the durable fix is relay-side (distinct admin identity or a custom attribute per relayed author), not prefix parsing.
- The **Action Center** `first_response_risk` signal (`src/lib/actionSignals.ts`) now loads the same roster (emails + admin ids + Slack names) and passes it to `computeSla`, so the alert list matches the Workbench instead of counting relayed replies as unanswered.
- **Durable relay identity (Option B, Aug 2026)** — the root cause was in `slack-events`, not the engine: the relay already tried to post under the teammate's own Intercom admin id, but resolved it from a **hardcoded two-entry map** (`joel@lovable.dev → 8430778`, `kristina@lovable.dev → 9985999`) that was stale (Joel's real id is `9852095`, Kristina's roster email is `kristina.bodurova@lovable.dev`) and had **no entry for Tine, Matt, Eren or Tejas** — so every one of their Slack replies fell back to the relay admin (Sam, `9520895`). Fix, all in `supabase/functions/slack-events/index.ts`: (1) the map is gone; the sender is resolved against the LIVE `teammates` table by **`slack_user_id` first** (exact, survives a Slack-profile email that differs from the roster email) and by **email** second, `active = true` only; (2) the body prefix now carries a **machine-readable marker** — `[From: <Display Name> (<email>) via Slack]` — so attribution no longer depends on display-name collisions; (3) **fail loud, never drop**: if no admin id resolves, or Intercom rejects the teammate id on the reply call, the reply is still delivered under the relay admin and the gap is upserted into `public.relay_attribution_gaps` (`slack_user_id` PK, email, display name, reason, occurrence count, last conversation id, `resolved_at`). Engine side, `computeSla` now prefers an **exact email match** parsed out of `relayFrom` against `supportEmails` before falling back to `supportSlackNames`, which closes the display-name-collision limitation for all new traffic. **Option A stays active** — historical parts written before this change carry only the name, so the name parser is still the only attribution for them.
- **Relay-only roster class (`role='csm'`, Aug 2026).** CSMs will never be Intercom admins, so `teammates.intercom_admin_id` is now **nullable** and `role` accepts `'csm'` (constraint: a row must carry at least one of admin id / Slack id / email). A CSM sits on the roster purely so `slack-events` can RESOLVE who spoke: their Slack reply still relays under the fallback relay admin (Sam) with the `[From: … via Slack]` marker, but **no identity gap is recorded** — the gap reason is now `not_on_roster` and fires only when the sender matches no active roster row at all (previously `no_intercom_admin_id`, which fired for every admin-id-less teammate). **FRT impact — intentional:** the First-Response roster is `role='support'` ONLY, so a CSM reply does **not** stop the First-Response clock, and (posting under Sam) reads as `sam_ai` to the engine either way. Same for resolution/cadence "our reply" predicates. Diana (`U0AK8TF9P0D`, `diana@lovable.dev`) is seeded as the first `csm` row and her gap row was marked resolved. **UNVERIFIED:** no live Slack reply from a `csm` row has been relayed since the change.
- **Action Center signal `relay_identity_gaps`** (family: review) counts unresolved `relay_attribution_gaps` rows and lists the offending Slack sender + reason. Non-zero means a relayed reply landed under Sam and will read as unanswered to the SLA engine; the fix is to set that teammate's `intercom_admin_id`, then mark the row resolved. **UNVERIFIED:** no live gap row has been produced yet — the write path has not been exercised end-to-end from a real Slack reply. Posting as an arbitrary admin id was validated indirectly only: Tine `10476723`, Matt `10765619`, Eren `10475465` and Tejas `11216057` all appear as part authors on v3 tickets in the last 30 days (active seats); **Kristina `9985999` does not appear in that window and stays unverified BY EXPECTATION, not by suspicion — she is on leave until approximately Nov 2026, so her seat cannot be exercised before then. Do NOT treat her silence as a dead seat or "fix" her roster row; re-verify on her return.**


- `evaluateCompliance` reads these two fields — and only these — for First Response. The older `firstHumanReplyFromInbox*` fields remain on `SlaResult` for reference/display only.

**Work-Before-Ticket** (`workBeforeTicketS` / `workBeforeTicketBusinessHoursS`) — commit `9edcf7a` — is the exact **mirror** of the clamped FRT: **`max(0, B − A)`**, i.e. how long Support was already working the issue before the ticket existed. It is a **Tenet #1 ("no work without a ticket") process signal, NOT an SLA breach**, and never enters any `%met`. **Distinct from pre-inbox time:** pre-inbox = the *customer's* total wait before the anchor; Work-Before-Ticket = *our* documented work that predates the anchor. Surfaced on the **Workbench only** (Work Before Ticket card + by-source breakdown).

**Stop-the-clock resolution — inbox-anchored** (`resolutionActiveS` / `…BusinessHoursS`): active in-our-court time walked from `slaClockStartS` (NOT `created_at`) to `last_close_at ?? first_close_at`. Excludes intervals where we replied and are awaiting the customer (customer public parts open a segment; a public reply by `human_admin` or `sam_ai` closes it) AND excludes closed-then-reopened dormant gaps. Guard: if `closeAt < slaClockStartS` → 0. **Why anchored:** Sam's pre-handoff handling and pre-ticket Slack work are pre-Enterprise, so resolution no longer counts them — combined with the ball-in-our-court walk, we neither breach because a customer is slow (one real ticket: 68 of 76 business-hours were the customer working with their own IT department) nor because Sam took time before handoff.

**A `close` also stops the resolution clock** (commit `e729937`, `computeResolutionActive` in `slaMetrics.ts`): a part with `part_type === "close"` closes the active segment if the ball is with us and sets `ballWithUs = false` — at close the ball has left our court. A later customer message / reopen opens a **fresh** in-our-court segment. **Why:** previously the clock only stopped on OUR public reply, never on a close. In the very common "thanks!" → we close without replying pattern, the customer had the last word so the ball was left with us; if the ticket was later reopened, `last_close_at` jumped forward and the engine counted one unbroken in-our-court segment across the entire dormant gap → a **phantom resolution breach**. Worked example: Experian ticket `215474664060068` (Sev 3) showed ~340 business-hours against a 75h target; true active time ≈ 9.5h (compliant). Applies **retroactively** — resolution is computed live over `raw_payload`, so no backfill is needed.

**Scope / honesty note — this fixed only the reopen-phantom (over-count) class.** Two related resolution-clock issues remain **OPEN**, deferred to the open-ticket-ingestion work: (a) **pre-anchor-reply over-count** — the loop hardcodes `ballWithUs = true` at the inbox anchor even when Support already replied just before it; (b) **late-inbox-anchor under-count** — Slack-native tickets ticketed at or near close measure only a tail. Neither is fixed; do not read the e729937 fix as covering them.

**Pre-inbox time — process-health signal, NOT an SLA** (`preInboxTimeS = enterpriseInboxAssignedAtS − created_at`, else `null`): the calendar time between ticket creation and the Enterprise Inbox assignment — i.e. "work happening before a ticket exists" / Sam's handling window / pre-ticket Slack chatter. Surfaced as a KPI card on the batch and labelled explicitly as a process signal. Known caveat: its tail currently **mixes** legitimate Sam-handling time with true pre-ticket Slack work; a future split into "Sam-first" vs "Slack-native" pre-inbox is noted.

**Escalation detection** (`detectEscalation`, `escalationTs` + `escalationBasis`): retained for the live-Analyze display strip and back-compat. `evaluateCompliance` no longer branches on it.

**Initiation classification** (`initiatedBy: "customer" | "agent"` on `SlaResult`): derived from the conversation's source-author actor. `"agent"` only if source actor is `human_admin` or `sam_ai`; customer / operator_bot / system / unknown all default to `customer` — anti-masking, so an ambiguous source never silently drops a ticket out of First Response. Known limitation: a forwarded customer email whose source author is our shared inbox (`@lovable.dev`) misclassifies as `agent` — accepted; to be corrected by a future manual override.

**Flags** (`SlaFlags`): `isTicket`, `samParticipated`, `noHumanReply`, `hasParts`, `noCustomerParticipant`, **`manuallyLogged`**.

- **`manuallyLogged`** = `true` when the stripped source body matches `/manually logged slack_thread/i` — the generated signature of our own Enterprise Support Hub bulk-add tool. These threads have no real reply timestamps (`created_at` = import moment, 0 comments) → **unmeasurable for SLA**. Excluded from all compliance.

**Origin** (`detectOrigin`): advisory `slack | email | other` badge — not used by any metric clock.

**Aggregate** (`aggregate`): `{ avg, median, p90, p95, n, nNull }` over nullable numbers.

### Self-serve enterprise (SSE) — the plan-tier dimension (28 Aug 2026)

A second commercial tier ships alongside standard Enterprise: **self-serve enterprise**, sold with **NO SLA commitments** and a **1-hour triage target**. It has **no separate views** — every v3 surface stays one population — but every ticket now carries an explicit plan tier so SSE can never be silently scored against Enterprise commitments.

**Where the tier comes from — the Intercom inbox, nothing else.** `settings.sse_intercom_inbox_id` (new, empty by default) names the SSE inbox; `settings.intercom_inbox_id` remains Enterprise. `supabase/functions/_shared/v3-inboxes.ts` (`resolveInboxes`, `inboxSearchClause`) is the single source: it yields the ingest id list, the plan for a `team_assignee_id`, and the Intercom search clause. **While `sse_intercom_inbox_id` is empty the resolver returns exactly the previous single-inbox behavior** — one id, plan `enterprise`, an identical `=` search clause. The feature is inert until configured.

- `intercom_tickets_v3.plan_tier` — `text NOT NULL DEFAULT 'enterprise'`, `CHECK IN ('enterprise','sse')`, indexed. Every pre-existing row backfilled to `enterprise` by the default.
- Writers updated in lockstep: `sync-v3-open`, `sync-v3-closed`, `sync-v3-gap-scan`, `reconcile-v3-open`, `_shared/v3-finalize.ts` (its `enterpriseInboxId: string` param became `inboxes: InboxResolver`; the not-ours skip reason is unchanged). Gap-scan counts Intercom across **both** inboxes so its comparison against our store stays like-for-like.
- **NOT changed:** `intercom-webhook` still guards on the Enterprise inbox only — it feeds the legacy `manual_conversations` bridge, not v3. SSE tickets reach v3 through `sync-v3-open`.

**Policy resolution is now (anchor, plan), not anchor alone.** `sla_policy_versions.plan` (`'enterprise' | 'sse'`, default `enterprise`) partitions versions; `resolvePolicy(anchorMs, versions, plan)` never crosses plans. Seeded SSE version — *"Self-serve enterprise (triage only)"*, `effective_from 2026-01-01`, `provisional`: **triage 3600 s business, and no other target row at all** — so first response, resolution and cadence resolve to "no target", not to a lenient one. `BUILTIN_SSE_POLICY` in `useSlaBatch.ts` mirrors that shape as the loud fallback.

**Clock start.** SSE anchors the same way (first inbox team-assignment, else `created_at`). The engine no longer hardcodes one team id: `registerAnchorTeamIds()` / `isAnchorTeamId()` in `slaMetrics.ts`, registered from `settings.sse_intercom_inbox_id` by `useSlaBatch`.

**Surfaces.** Triage (`/triage`) grades each row against **its own** target — 30 min Enterprise, 60 min SSE — and carries a `Plan` column (`SSE` pill / `Enterprise`) plus a Plan field in the detail sheet. The SLA Dashboard adds a **Plan selector defaulting to `Enterprise`**, because averaging a commitment-free tier into a compliance scorecard would inflate it; the count of SSE tickets in-window is always shown, labelled *"not scored here (no SLA commitments)"*.

**UNVERIFIED:** no SSE inbox id is configured yet and no SSE ticket exists, so the ingest path, the `sse` policy resolution and the SSE triage band have **not** been exercised against real data — only unit-tested and type-checked (118 SLA tests green).


#### SSE as a first-class cut across find / report / watch (1 Sep 2026)

The SSE inbox is now configured (`11433093`) and carrying tickets, so plan tier stops being an ingest detail and becomes a visible dimension everywhere.

**Shared primitives.** `src/lib/planTier.ts` (`PlanTier`, `PlanScope`, `PLAN_LABEL`, `planTierOf`, `inPlanScope`) and `src/components/PlanScopeSelect.tsx` (`PlanScopeSelect` selector, `PlanBadge` pill). Every surface below uses these — no page normalizes `plan_tier` on its own.

**Find.** Inbox v3 gains a `Plan` filter, a sortable `Plan` column on both the Active and Finalized tables, and a Plan field in the detail sheet (SSE reads *"no first-response SLA, 1h triage"*). Owner dashboards v3 carry the same sortable `Plan` column.

**Report.** Plan scope selectors: Monthly Lookback, Monthly SLA Report, SLA Workbench and SLA Dashboard default to **Enterprise**; CSAT Report, Trend Report, Analytics v3 and Resolution Anatomy default to **All plans** (those metrics are plan-neutral). Under the SSE scope the Monthly SLA Report **hides** §2 headline, §3a/§3b by-severity and §4 breaches behind an explicit banner rather than reporting 0% — a target that does not exist can be neither met nor breached; §2b triage, §3c cadence, §5 source mix and §6 data quality still render.

**Watch.** `src/lib/actionSignals.ts` drops the blanket `SUPPRESS_SSE` flag. Queue signals (`untriaged`, `unassigned_tickets`) now cover **every** plan. SLA-risk signals (`first_response_risk`) stay Enterprise-only via `enterpriseOnly()`, because SSE has no FR commitment. New signal **`sse_triage_risk`** ("SSE triage past 1h", family `sla`, route `/triage`): SSE tickets still open with no Severity more than 3600 s after `intercom_created_at`, listing the offending Intercom ids.

**UNVERIFIED:** 3 SSE tickets exist at time of writing, so the SSE-scoped report panels and `sse_triage_risk`'s non-zero path have not been exercised at volume; type-check green, no runtime check of the non-zero triage-risk branch.

### Compliance evaluation — policy targets (DATA), `parseSeverity`, `evaluateCompliance`

**Targets are no longer hardcoded.** Since the SLA-policy-config build (see *"SLA policy config — admin-editable, effective-dated targets"* below), every SLA target and the business-hours calendar live in `sla_policy_versions` / `sla_policy_targets` and are resolved **per ticket** by its inbound anchor. `SLA_TARGETS`, `CADENCE_TARGETS`, `TRIAGE_TARGET_S` and `DEFAULT_BUSINESS_HOURS` in `src/lib/slaMetrics.ts` are **retained as the built-in fallback/default only** — used when the config fails to load, is empty, or a ticket predates every version, and always with a loud `PolicyFallbackBanner`.

**Live values in the active (only) version — `Seed from code constants (provisional)`, `effective_from 2026-01-01T00:00:00Z`, `status='provisional'`** (queried from `sla_policy_targets`, 6 Aug 2026):

| Severity | First Response | FR clock | Resolution | Res clock | Cadence max gap | Cadence clock |
|---|---|---|---|---|---|---|
| Sev 1 | 30 min (1800 s) | **business** | 8 h (28 800 s) | business | 1 h (3 600 s) | **business** |
| Sev 2 | 4 h (14 400 s) | business | 30 h (108 000 s = 2 business days) | business | 4 h (14 400 s) | business |
| Sev 3 | 15 h (54 000 s = 1 business day) | business | 75 h (270 000 s = 5 business days) | business | no target (`NULL`) | — |
| Sev 4 | 45 h (162 000 s = 3 business days) | business | no target (`NULL`, best-effort) | business | no target (`NULL`) | — |

Triage: single row, `severity IS NULL`, **30 min (1800 s), business** clock. Business hours for this version: **Europe/Berlin, Mon–Fri (`work_days [1,2,3,4,5]`), 09:00–24:00, `holidays: []`**.

> **Drifted from the code constants on purpose:** leadership judged Sev 1 wall-clock 24/7 too aggressive without off-hours coverage, so **Sev 1 First Response and Sev 1 Cadence were moved to the business clock in the policy data**. The engine constants still say `calendar` for those two — that is expected: the constants are only the fallback, the DB is what the surfaces score against.

`parseSeverity(raw)` reads `raw_payload.custom_attributes.Severity`. Returns `null` for missing / unknown; **never** defaulted to a severity — a missing mapping surfaces loudly in a visible "Unclassified" bucket rather than hiding in Sev 3 (surface-errors-loudly). `evaluateCompliance(sla, severity, targets = SLA_TARGETS)` returns `{ severity, firstResponse, resolution }` each with `{ value, target, clock, met }` where `met` is `null` when unmeasurable; the surfaces pass the **row's resolved policy targets** in, never the constants.

- **First Response** picks the clock (`business` vs `calendar`) per severity and reads **`firstSupportReplyFromInbox*`** (SUPPORT roster, clamped) — nothing else. `escalationBasis` branching is gone.
- **Resolution** reads **`resolutionActive*`** (also inbox-anchored). Raw `ttr*` is never used by compliance. Sev 4 returns `met: null` (no committed target).


### Read-only fetch — `supabase/functions/sla-ticket-analyze`

- `verify_jwt = true`, `POST` only. Accepts `{ ids: string[] }`; `normalizeId` handles URL forms and prefixes. Deduplicates + caps at `MAX_IDS = 10`.
- Each id → `GET https://api.intercom.io/conversations/{id}` (`Intercom-Version: 2.13`, reuses `INTERCOM_API_TOKEN`).
- **STRICT read-only** thin proxy: all metric logic runs client-side in `computeSla`, zero server-side duplication, Intercom stays read-only.

### UI — split into SLA Dashboard + SLA Workbench (shared hook)

The old single `/sla-test` page is retired; `/sla-test` now **redirects to `/sla`**. Two pages share one data spine:

- **`src/hooks/useSlaBatch.ts`** — loads `intercom_tickets_v3` filtered by `lifecycle_status IN ('finalized','reopened_after_finalize')` (all owners, paged 500, ~287 rows), runs `computeSla` + `classifyRow` per row, and returns `{ inScope, excluded, noCustomer, manuallyLogged, refresh }`. Both pages consume this hook — no duplicate fetch/enrichment.
- **`src/components/sla/KpiCard.tsx`** — shared timing tile.

**Snapshot, not live** (unchanged rationale): live-fetching the whole population per page load would hammer the metered Intercom API; snapshot is fast, free, reproducible, as-of-a-time. Live per-ticket Analyze remains the validation escape hatch (on the Workbench).

Population classification (`classifyRow`, checked in this order, unchanged):

1. **manuallyLogged** — `sla.flags.manuallyLogged === true`. Checked FIRST. Shown with a visible count in both pages' scope chips ("Manually-logged (excluded): N"). Excluded from all compliance. **Why up-front:** our own bulk-import artefacts with zero real timestamps — running compliance on them would produce garbage; a visible count lets us watch volume.
2. **excluded** — `rsa_override === false` OR (`rsa_override == null` AND (`enterprise-fyi` OR `enterprise-duplicate` tag)) OR `merged_ticket` tag OR `customer_resolution_method IN ('not_enterprise','prospect_personal','enterprise_prospect')` (Rules 0 / 0b / 4b — the disposition gates keep both out-of-scope and prospect tickets out of the SLA population) OR **`customer_key ∈ testAccountKeys` AND `showTestData === false`** (account-level `test_account` exclusion — see "Test/sandbox accounts" below). Explicit `rsa_override === true` overrides tag-based exclusions.
3. **noCustomer** — `sla.flags.noCustomerParticipant`.
4. **inScope** — everything else. Compliance runs only over `inScope`.

#### Test/sandbox accounts — `is_test` + "Show test data" toggle

`v3_customer_accounts.is_test boolean NOT NULL DEFAULT false` marks an account as a demo sandbox. `useSlaBatch` loads the set of test account keys (`testAccountKeys: Set<string>`, exposes `isTestAccount(key)`) alongside `customerLabels`, and accepts a `{ showTestData: boolean }` option threaded from the page. `classifySlaBatchRow` takes `ClassifyOpts` and short-circuits any row whose `customer_key ∈ testAccountKeys` into the `excluded` bucket (reason `test_account`) UNLESS `showTestData === true`, in which case the test-account rows fall through the normal classification and land in `inScope`/`noCustomer`/etc. exactly like real tickets.

Both **SLA Dashboard** and **SLA Workbench** render a default-OFF `TestDataToggle` (shared component, exported from `SlaWorkbench.tsx` and re-used on Dashboard) plus a loud amber/destructive `TestDataBanner`: **"⚠ Test data included — these figures are NOT real compliance."** When the toggle is OFF, behavior is identical to before — the test account is invisible to the scorecard, breach lists, customer dropdown, and every KPI. When ON, the test account appears in the customer dropdown and its breach tickets flow into the scorecard and breach lists like any other customer.

Currently one account is flagged: `let_it_fly_test_account` (Let it Fly).

**Why (design intent — the anti-drift anchor):**

- Matt wanted populated breach reports to demo without either waiting weeks for a real customer to breach or fabricating fake data that pollutes real numbers. `is_test` on the ACCOUNT gives a durable, safe sandbox with the toggle as a single ON/OFF switch — never bolted onto individual tickets.
- **Intercom-as-truth is preserved.** Sandbox breaches are REAL throwaway Intercom tickets that we deliberately leave to breach (unresponded → FRT breach, unresolved → resolution breach). Nothing is mocked in the engine.
- The throwaway tickets are left **UNTAGGED** on purpose — no `enterprise-fyi`, no `enterprise-duplicate`. That way `is_test` at the account level is the SOLE thing excluding them, and lifting `is_test` (via `showTestData=true`) fully surfaces them. If we exclude-by-tag instead, the toggle can't reveal them.
- For Let-it-Fly specifically, `is_test` **replaces** `enterprise-fyi` as the exclusion mechanism. Per-ticket `fyi` would keep sandbox rows hidden even with `showTestData=true`, defeating the purpose. This is why the migration also implicitly retires tag-based exclusion for that account in favor of the account flag.
- **Real compliance can never silently drift.** Toggle default OFF + banner whenever ON + zero contribution to real aggregates in OFF-mode = surface-loudly + no-silent-contamination, matching the wider knowledge doc's design principles.
- **No new engine surface.** `slaMetrics/computeSla` semantics are untouched — sandbox tickets get the exact same timing computed as production tickets. The change is purely one additional population filter next to the existing tag/rsa/disposition exclusions.



#### SLA Dashboard — `/sla` (`src/pages/SlaDashboard.tsx`) — DEFAULT LANDING

Leadership-facing, lean/at-a-glance. Top → bottom:

1. **Population + coverage chips** — in-scope N, severity coverage %, excluded, internal/no-customer, manually-logged.
2. **Compliance scorecard** (the centerpiece) — per-severity rows Sev 1–4 + Unclassified, **customer-initiated basis** (no toggle here — this is the honest default). FR %met and Res %met are tinted by band: **≥90 healthy · 75–89 warning · <75 breach**; **color ALWAYS accompanies the visible % number and its target** (never color alone). A per-row destructive breach-count badge appears when breaches > 0. Sev 4 resolution renders "best-effort".
3. **"How these are measured" popover** — short notes on the inbox-anchored clock, stop-the-clock resolution, business-hours model, provisional targets.

**Deliberately EXCLUDED from the Dashboard:** the engine/Legacy toggle, Analyze-by-ID, the raw per-ticket table, the timing KPI tiles, the by-source breakout, and the surfaced breach lists. **Why the timing tiles are NOT on the Dashboard:** the aggregate medians are **severity-blind** (blended across Sev 1–4) so they don't map to any single target and would mislead sitting next to the per-severity scorecard. They live on the Workbench, where the operator can see severity + source alongside. Breach *counts* appear on the Dashboard as small per-severity badges so "did any breaches happen?" is instantly visible; the full breach *lists* live on the Workbench.

#### SLA Workbench — `/sla-workbench` (`src/pages/SlaWorkbench.tsx`) — practitioner detail

Everything the old `/sla-test` did, restructured onto the shared hook and extended:

- **Tab 1 — "Analyze by ID (live)":** ≤10 ids/URLs → `sla-ticket-analyze` → runs `computeSla` on each returned conversation. Per-ticket card shows headline strip (our human FRT calendar+BH vs Intercom `time_to_admin_reply` + Δ + Intercom SLA status), origin + flag badges, color-coded timeline, calendar | BH metric table, prominent amber "no customer / internal" warning. Validation / spot-check tool only.
- **Tab 2 — "Population review (snapshot)"** (renamed from "Batch (stored)", which described the storage mechanism rather than the job): the full data-behind-it view. Corrected/Legacy toggle preserved; full sortable per-ticket table preserved.

**Batch KPI cards** aggregate over in-scope rows (all severities — severity-blind medians are useful HERE alongside the tables that show the severity/source segmentation):

- **Human first reply · bus.hrs** ← `firstHumanReplyFromInboxBusinessHoursS`
- **Human first reply · calendar** ← `firstHumanReplyFromInboxS`
- **First response any-agent · calendar** ← `firstResponseAnyAgentS` (retained — includes Sam)
- **Time to resolve · bus.hrs** ← `ttrBusinessHoursS` (retained as raw reference; compliance uses `resolutionActive*`)
- **Pre-inbox time (pre-Enterprise / work-before-ticket)** ← `preInboxTimeS`, labelled "a process signal, not an SLA"

**Compliance section** (`ComplianceSection`, rendered at the TOP of the batch view): groups in-scope rows by `parseSeverity(...)` into Sev 1 / 2 / 3 / 4 / **Unclassified**. Per-severity columns: N, FR target, **FR %met, FR breaches, FR n/a, Res target, Res %met, Res breaches**. (The `Res breaches` column mirrors `FR breaches` — same right-aligned destructive style, "—" when 0. Sev 4 shows "—" in Res breaches since it has no resolution target.)

- **First-Response basis toggle** (`frBasis: "customer" | "all"`, default `"customer"`): FR counters and the "First-Response breaches" collapsible are computed over `initiatedBy === "customer"` rows only by default; toggle to "All tickets" for the source-independent total. An always-visible line reads `Initiation: X customer-initiated · Y agent-initiated`. **Why:** ~half of enterprise tickets are opened by us; leaving agent-initiated in padded Sev 2 FR upward (measured 83 % → 77 % once segmented). Anti-masking: total is one click away, agent-initiated count always visible, per-severity `n` is always the full in-scope count.
- **Resolution is unaffected by the toggle** — always over all in-scope rows. Support genuinely works relayed / outbound tickets to resolution.
- **By-source breakout** (collapsible, directly below the per-severity table): rows **Slack · Sam-first · Direct (email/messenger, no Sam)** + a greyed **Manually-logged (excluded)** row for volume watch. Columns: n · FR %met · Res %met · Pre-inbox median. Source per row = `origin === "slack"` → **Slack**; else `sla.flags.samParticipated` → **Sam-first**; else **Direct**. FR %met respects the basis toggle above; Res %met covers all tickets in each bucket. **Why:** the aggregate hid three very different populations — Sam-first is the strongest performer, Slack the weakest with a large pre-inbox lag (real work happens before the ticket). **Data fact from the current snapshot:** Sam first-lines EMAIL / MESSENGER only — **0 public Sam replies on Slack-sourced tickets** — so the Slack bucket is humans-reply-directly, not Sam-handoff.
- Two collapsible breach lists below the table: "First-Response breaches (N)" (respects basis) and "Resolution breaches (N)" (all in-scope, sorted worst-first).

Also preserved: a **Legacy (compare)** view backed by stored Intercom fields, kept verbatim as before/after evidence.

**Duration display** (`formatDuration` vs `formatBusinessDuration`): calendar durations render as 24 h days ("1 d 4 h"); business-hours durations render as **business days** ("bd", 1 bd = 15 h — e.g. 30 business hours displays as "2 bd", not "1 d 6 h"). Compliance section picks the formatter per column by the target's clock.

**Tests** — `src/lib/__tests__/slaMetrics.test.ts` (**78 passing** at last count; 80 across the whole vitest suite), including the triage suite (anchor→first-Severity duration, chronological `from` derivation across `null→4→2→1`, no-Severity → `null` / `hasSeverityEvent === false`, pre-anchor Severity clamped to 0). Cover actor classification, escalation post-AI-handoff (back-compat), `noCustomerParticipant`, `manuallyLogged` detection, `businessHoursBetween` (weekday, DST, weekend), BH ≤ calendar invariants, initiation classification, inbox-anchor detection with and without an Enterprise Inbox assignment, FR-from-inbox (pre-anchor human ignored; no post-anchor reply → null; anchor-null fallback to open), stop-the-clock resolution from the anchor (Sam's pre-anchor handling excluded), `preInboxTimeS`, `formatBusinessDuration`.

### Triage time — Severity-event capture, the MEASURE-FIRST metric & triage discipline (commits `3f5272d` bump · `backfill-v3-event-details` · `2c86e1f` engine · `39c086f` report · `b951be7` BH-headline · `05c77ea` discipline flags · `2e4fbbd` overrides migration · `e9b3bae` Workbench section)

**The data that makes it possible.** Severity changes arrive from Intercom as conversation parts with `part_type='conversation_attribute_updated_by_admin'` carrying `event_details.attribute.name='Severity'`, `event_details.value.name` (the NEW value), `created_at` and `author`. Those `event_details` only exist from **Intercom-Version 2.13** onward (see §16 for the version spike and the additive-only regression check). 2.13 does **not** send `value.previous`, so the previous value is derived chronologically.

**One-off backfill — `backfill-v3-event-details`** (edge function, **kept in place, deliberately NOT cron'd**). New and still-active tickets pick up `event_details` naturally on their next sync; **already-finalized tickets are never re-fetched**, so they would have stayed blind forever. The backfill re-fetched the **~71 `finalized` / `reopened_after_finalize` tickets created on or after `2026-07-15`** at 2.13 and refreshed **ONLY `raw_payload` + `last_synced_at`** — no re-finalize, no `lifecycle_status` / `reopen_count` / baseline / `custom_attributes` / EAV / `customer_key` writes, so no existing number moved. Paced, 429-aware, time-budgeted (~110s) and idempotent, so a re-run is safe. **Why the July-15 line-in-the-sand:** that is when the **Triage policy started** — pulling older tickets in would pollute the baseline with pre-policy behaviour. Result: **71/71 refreshed, 70 carrying a Severity event.**

**Severity-event parser (`src/lib/slaMetrics.ts`).** `TimelinePart` gained **`eventDetails`**, populated from each part's `event_details` (`null` when absent). **`extractSeverityEvents(timeline)`** selects the Severity attribute-update parts and returns a **ts-ascending** list of `{ ts, to, from, authorType, authorEmail }`: `to = String(event_details.value.name)`; `from` uses `value.previous` when present and otherwise is derived chronologically (`from[0] = null`, `from[i] = events[i-1].to`). Author typing reuses the existing **`Actor`** model, which already includes **`shared_inbox`** (B6).

**Triage metric — `computeTriage` (MEASURE-FIRST, PROVISIONAL target).** Time from the **Enterprise-Inbox anchor (`slaClockStartS`)** to the **FIRST Severity assignment**. Fields on `SlaResult`: `firstSeverityAtS`, `firstSeverityValue`, `timeToTriageS` (wall-clock), `timeToTriageBusinessHoursS` (Berlin business clock), `severityEventCount`, `hasSeverityEvent`.

- **`null` = not-evaluable** when there is no Severity event or no anchor — **never defaulted to 0** (surface anomalies loudly, never invent values). A Severity event **before** the anchor **clamps to 0**.
- **The only target is PROVISIONAL** (`TRIAGE_TARGET_S`, 30 min business hours — see the discipline flags below). It is unratified; the distribution remains the evidence from which it gets ratified or moved. Committing a number before seeing the data is exactly the mistake this whole track exists to avoid.
- **Why triage is the metric leadership can have as a single number:** it is **severity-agnostic**. A blended "global FRT average" mixes severities with different targets *and* different clocks (Sev 1 calendar vs Sev 2–4 business hours), so its average is meaningless; triage time has one definition for every ticket.
- **Pairing intent:** **triage-time + a (still-to-come) global FRT-compliance %** are the **two-part responsiveness view** for leadership, replacing the misleading single "global FRT average". One says how fast we *pick things up*, the other how often we *hit the committed clock*.

#### Business-hours headline (commit `b951be7`)

Report **§2b** now leads with the **BUSINESS-HOURS** clock: the four headline cards (median / average / p90 / n) and the by-final-severity mini-table all read `timeToTriageBusinessHoursS` (Europe/Berlin, Mon–Fri 09:00–24:00, DST-aware). **Wall-clock is kept but demoted** to a labelled secondary row: *"expected higher until off-hours coverage exists."*

**Why the flip.** There is **no off-hours coverage today**. Wall-clock triage is therefore inflated by overnight and weekend **arrivals** that get triaged at business open — a staffing-model fact, not slow work. Leading with wall-clock would have mis-stated the team's responsiveness and, worse, invited a target set against a number nobody can influence without a rota. Wall-clock stays visible (never hidden) because it is the customer-experienced reality and the argument for off-hours coverage.

The **honest coverage line** is unchanged and mandatory: *"Triage measurable for N of M in-scope tickets"*, with the note that `event_details` capture only starts **~15 July 2026** — earlier tickets are **NOT-EVALUABLE, not fast**.

#### Triage-discipline flags (commit `05c77ea`, `src/lib/slaMetrics.ts`)

Three booleans on `SlaResult`, computed in `computeSla`:

| Flag | Definition |
| --- | --- |
| `triageViolation` | `timeToTriageBusinessHoursS > TRIAGE_TARGET_S` (**1800 s / 30 min**, business-hours basis, **PROVISIONAL**). Not-evaluable rows (no Severity event, no anchor) are **never** violations — absence of data is never scored as a miss. |
| `answeredBeforeClassified` | The first **`human_admin` public** reply lands **before** the first Severity event. Sam (`sam_ai`) and `shared_inbox` are deliberately excluded — neither is a triaging teammate. |
| `severityRecordedAtClose` | The first Severity event lands within `SEVERITY_AT_CLOSE_WINDOW_S` (**1800 s / 30 min**) of the close. |

Surfaced as the Report §2b **"Triage discipline (provisional 30-min target)"** row over the evaluable set: **% over target · % answered before Severity · % Severity recorded at close.**

**KEY INSIGHT — why these flags exist.** Time-to-triage today measures triage **DISCIPLINE**, not reaction speed: *is Severity set at first touch, or bookkept at close?* Exemplar **ticket `215475222535453`** — engaged in **~2 h** (Sam instant, human reply at 2 h) but Severity, and the other three "required-at-closure" canonical fields, were **not set until it closed 75 h later**. The ticket was **worked fast and recorded late**; only the discipline flags separate those two stories. So the metric's real job is to drive the **"set Severity at intake"** policy — which is also what will make the triage number trustworthy as a speed metric later.

**Target invariant.** The triage target (30 min) must **always stay ≤ the strictest FRT SLA** (Sev 1 FR 30 m). Triage is a *precondition* of a correct first response — you cannot hit a severity-specific FRT target for a severity you have not assigned — so if Sev 1 FR ever tightens, `TRIAGE_TARGET_S` moves with it. Noted in-code above the constant.

#### Override model — ONE table, `public.sla_violation_overrides` (consolidation `93f3fe0`)

**Every SLA/triage/cadence exception lives on ONE table.** `public.sla_violation_overrides` — one row per `(intercom_conversation_id, metric)` (**UNIQUE**), columns `metric`, `reason`, `note`, `created_by`, `created_at`, `updated_at` (trigger-maintained), index on `intercom_conversation_id`.

- **`metric` CHECK:** `triage` · `first_response` · `resolution` · `cadence`.
- **Unified 9-value `reason` CHECK:** `holiday` · `off_hours` · `customer_hold` · `non_support_thread` · `recorded_at_close` · `answered_before_classified` · `data_artifact` · `genuine_miss` · `other`. The UI narrows the dropdown per metric (`REASON_OPTIONS` in `SlaWorkbench.tsx`): triage → off_hours / non_support_thread / recorded_at_close / answered_before_classified / genuine_miss / other; FR + Resolution → holiday / customer_hold / data_artifact / genuine_miss / other; cadence → customer_hold / off_hours / non_support_thread / data_artifact / genuine_miss / other.
- **RLS: SELECT = any authenticated; INSERT / UPDATE / DELETE = ADMIN-ONLY** (`has_role(auth.uid(),'admin')`). The Workbench hides the Excuse / clear controls for non-admins, but RLS is the real enforcement. `created_by` records **who** (email from `supabase.auth.getSession()`).
- Saving is an **upsert `onConflict=intercom_conversation_id,metric`**, so editing an existing override is the same call.

**WHY admin-gated everywhere (and why this REVERSED the earlier triage model).** Triage overrides originally shipped **team-writable** (adoption beats gatekeeping). That is now **deliberately reversed**: *every* SLA target on this system is still **PROPOSED, not ratified**, so an override is not "excusing a miss against a commitment" — it is **editing the evidence used to argue the targets**. Until targets are ratified we gate **uniformly** at admin, then loosen later (per-metric RLS, or a committed-flag that opens writes only for ratified metrics). Any doc/Flow text still describing triage overrides as team-writable is **stale** — corrected in this pass.

**Dropped / dead tables.**
- **`public.triage_overrides` has been DROPPED** (it held 0 rows). Nothing references it.
- **`public.sla_breach_overrides` still physically exists but is a DEAD MIRROR** — unreferenced by any code path, holding 4 stale `resolution` rows that were copied into `sla_violation_overrides` at consolidation time. It is a **cleanup candidate**, not a live table; do not read or write it.

**Workbench surface** (`src/pages/SlaWorkbench.tsx`, same `filteredInScope` population / window / customer filter as everything else on the page) is now a **unified Violations table** with one column per metric — **First response · Resolution · Triage · Cadence** — each cell excusable through the shared `ExcuseDialog` (writes the matching `metric`). Header: **total violations · excused · OVERRIDE-RATE % · unexcused**, plus a per-reason breakdown across all metrics. Reason **auto-suggestion** is per metric: triage → `recorded_at_close`, else `answered_before_classified`; cadence → `customer_hold` when the worst gap overlapped a customer-wait.

**Violations table sorting (UI-only).** A **Sort** selector sits next to "Hide fully-excused": default **Worst first (most misses)** (unchanged from the previous implicit order), plus **Severity Sev 1-first**, **Severity Sev 4-first**, **Longest resolution**, **Longest first response**, **Oldest**, **Newest**. Rows with **unknown severity always sink** to the bottom of the severity sorts. Sorting operates on a **copy** of the row array, so the header counts (total / excused / override-rate / unexcused) and the per-reason breakdown are computed from the unsorted set and never change with sort order.

**Cadence in "Compliance vs proposed SLA targets" (Workbench `ComplianceSection`).** The per-severity compliance table now carries **Cadence target · Cadence %met · Cadence breaches (with excused count inline)**, matching the existing First-Response and Resolution column triplets. Cadence is scored per row with `evaluateCadence(sla, sev, row.policy.cadence[sev]?.maxGapS)` — the same call the Violations table already used — so the summary and the detail can never disagree. Severities with **no cadence target render no cell content** rather than a misleading 100%.

**Why the unified table.** Override-rate is a tracked **red-flag KPI** — a high rate means the *target or the population* is wrong, not that the team is excused. One table + one section keeps the tail workable: excuse off-hours / non-support-thread / customer-hold noise so the **genuine misses stand alone**, with no chance of the same ticket being excused in one place and counted in another.

#### Communication cadence — the fourth SLA metric (engine + all surfaces; `857c4bd` Report · `a96296a` Workbench · `3dc338e` Dashboard)

**WHAT.** Cadence measures **proactive-update frequency during an active incident** — how long the customer ever went without a public update from us while their ticket was live. It is bound to **Sev 1 and Sev 2 ONLY**.

`CADENCE_TARGETS` (**PROVISIONAL**, `src/lib/slaMetrics.ts`): **Sev 1 = 3600 s (1 h), WALL-clock** · **Sev 2 = 14400 s (4 h), BUSINESS hours** · **Sev 3 / Sev 4 = `null` → "no target"** — rendered as an italic *no target* chip, **never 0 %, never a breach**.

**MODEL — Phase-1 DRUMBEAT.** `computeCadence(timeline, closeAtS)` measures the **max gap between consecutive public Lovable updates**, and:
- **Customer silence does NOT pause the obligation** — a customer reply inside a gap does not reset the clock. The drumbeat is ours to keep.
- **The window INCLUDES the tail gap** — last Lovable public update → close. "Went dark, then closed" counts against cadence.
- Fields on `SlaResult` (spread from `computeCadence` inside `computeSla`, so every surface gets them from the one engine): `cadenceUpdateCount`, `cadenceMaxGapS`, `cadenceMaxGapBusinessHoursS`, `cadenceMaxGapOverlappedCustomerWait`, `hasCadence`.
- `evaluateCadence(sla, severity, overrideTargetS?)` returns `true | false | null`, picking the severity's own clock (Sev 1 wall, Sev 2 business); the optional third arg exists **only** for the what-if slider.

**Deliberately conservative — and the low %met is a GENUINE finding.** The drumbeat + tail-gap choices make cadence the strictest metric we have. That is intentional: the real behaviour pattern it exposes is **burst-then-silence** (heavy engagement, then a long quiet stretch before close), confirmed by a manual hand-walk of the worst Sev 2 gaps — it is a real finding, **not a measurement artifact**. The `cadenceMaxGapOverlappedCustomerWait` flag marks gaps during which we were *also* waiting on the customer; it exists purely for **interpretability** (and to auto-suggest the `customer_hold` override reason), and does **not** silently forgive the gap.

**HONESTY RULE (charter, non-negotiable).** **Evaluable = `hasCadence`** (the ticket actually has a cadence window). **Non-evaluable tickets are EXCLUDED from the denominator entirely** — never defaulted to met, never counted as a breach. Every surface carries an **"N of M evaluable"** coverage line, same rule as triage's coverage line.

**SURFACES** (all consume the same `useSlaBatch` — **no parallel computation path**):
- **`/sla-report` §3c "Communication cadence"** — per-severity (Sev 1 / Sev 2) `%met` + **median / p90 / longest max-gap**, an **overlapped customer-wait count**, the "N of M evaluable" coverage line, and a *"PROVISIONAL — targets not yet ratified; drumbeat model incl. tail gap"* caption.
- **`/sla-workbench` unified Violations table** — a **Cadence** column; a row counts only when the severity has a target (Sev 1/2) **and** `sla.hasCadence` **and** `evaluateCadence(sla, sev) === false`. Shows the worst gap on the severity's own clock, update count, and the overlapped-customer-wait flag. Excusable via `ExcuseDialog` with `metric='cadence'` (admin-gated), auto-suggesting `customer_hold` on overlap.
- **`/sla` Dashboard scorecard** — a **"Cadence (provisional)"** column matching the FR/Resolution cell pattern exactly: tone-coloured `%met` pill · target + clock · red breach badge linking to the Workbench · excused count · `N of M evaluable` chip. Sev 3/4 render *no target*. A PROVISIONAL footnote and a "Communication cadence (provisional)" entry in the "How these are measured" popover explain the model.
- **`/sla-what-if`** already exposes **live Sev 1 / Sev 2 cadence knobs** (via `evaluateCadence`'s `overrideTargetS`), so cadence is a **full first-class metric alongside FR / Resolution / Triage** in the visualisation-only slider — local state only, never persisted.

`SlaOverrideMetric` in `src/hooks/useSlaBatch.ts` includes `"cadence"`, so `isExcused(cid, "cadence")` works identically to the other metrics.

### Triage queue — `/triage` (`src/pages/Triage.tsx`) — READ-ONLY live queue
**Purpose:** show every OPEN Enterprise-Inbox ticket that still has **no `Severity`** custom attribute, oldest first, colour-graded against the triage target — the operational counterpart to the retrospective triage numbers on the Report/Workbench (which only cover closed tickets).

- **Population:** `intercom_tickets_v3` where `lifecycle_status ∈ {open, reopened_after_finalize}` and `custom_attributes.Severity` is absent/blank. Closed tickets are out by construction (Severity is required before close).
- **Age clock:** business-hours elapsed via `businessHoursBetween`, using the **policy-resolved** `businessHours` from `useSlaPolicy` (active version, falling back loudly to the engine defaults through `PolicyFallbackBanner`). Wall-clock elapsed is shown as a muted secondary column — never as the graded number.
- **Anchor:** `computeSla().slaClockStartS` (first Enterprise-Inbox team assignment) else `createdAtS`; the row labels which anchor was used ("inbox assignment" / "ticket created") so the number is never unexplained.
- **Target:** `activePolicy.triageTargetS` (currently 1800s / 30 min, provisional) — read from the config tables, not a constant.
- **Bands** (% of target): OK <50% · Approaching 50–80% · At risk 80–100% · Breached >100%. Row tint + pill, plus per-band counters above the table.
- **Freshness:** no live Intercom feed. `sync-v3-open-frequent` runs `*/5 * * * *`, so a newly-triaged ticket leaves the queue within ~5 min. The header shows "Data as of {max(last_synced_at)} · syncs every 5 min" with a manual refresh; a 30s local tick advances ages/bands without refetching.
- **Read-only by design** — no writes, no override table, no Severity assignment. Assigning triage from this view is a deliberate later step.
- **QUEUE MODES (24 Aug 2026):** the page now serves three queues behind a segmented control, kept in the URL as `?mode=` so the Action Center can deep-link. `needs_severity` (default, unchanged — bands, band counters, row tint, propose-severity batch button and the "Severity writes enabled" badge render ONLY here), `unassigned` (no `admin_assignee_id` in Intercom **or** no mapped Hub `owner`), and `either` (union). Predicates live in `src/lib/triageQueues.ts` (`isUnassigned`, `assignmentGap`, `hasSeverityValue`, `inTriageMode`) so the page and the Action Center signal cannot drift — same single-source pattern as `slaExclusions.ts`. The non-severity modes have **no target and no bands**: age is shown in business hours with wall-clock beside it on the same anchor, and a "Missing" column reads `no Intercom assignee` / `assignee not mapped` / `no severity`. No schema change — `admin_assignee_id` was already on the mirror.
- **Action Center signal `unassigned_tickets`** (queues family) counts the `unassigned` population over open/reopened rows AFTER the shared `isSlaExcluded` filter (fyi, duplicate, merged, prospect, non-enterprise, test accounts are not counted), lists the Intercom IDs, and links to `/triage?mode=unassigned`.
- **VERIFICATION (24 Aug 2026):** SQL over the 50 open/reopened tickets — 0 missing Severity, 0 missing assignee/owner (raw and after exclusions). Both queues are legitimately empty in steady state, so the NON-ZERO path of the unassigned queue and its Action Center card is **UNVERIFIED** against live data.


### Dev escalation board — `/escalations` (`src/pages/Escalations.tsx`) — HUB-OWNED lifecycle
**Purpose:** track Intercom tickets typed as a **Bug** or **Feature Request** alongside their **Linear** escalation issue, under a lifecycle **the Hub owns**, so an item stays visible until the *customer has actually been told* — long after Intercom has closed the conversation.

- **Population (automatic, no sync job) — BROADENED 2026-08-31.** One shared predicate `qualifies(ticket, override)` in `Escalations.tsx`, used by both the row build and the batched notes prefetch so the two can never drift. A ticket qualifies when `custom_attributes->>'Ticket type' ∈ {Bug, Feature Request, Incident}` **OR** it already carries a resolvable Linear/Escalated Issue reference (including the Hub `linear_url_override`) **at any ticket type**. Exclusions unchanged: `lifecycle_status = 'transferred_out'`, `customer_resolution_method = 'not_enterprise'`. **Intercom state is deliberately NOT a filter** — informational column only. WHY: the old gate admitted only Bug / Feature Request, so an escalation typed `Issue` was invisible even though it had a Linear link — found live via `SCA-3522` (Intercom `215475673305527`, type `Issue`) and `CLO-1225` (`215475556254768`, type `Question`), both linked, both missing from the board and therefore unsearchable. **CORRECTED SAME DAY:** the first cut also admitted `Issue` as a qualifying type, which dragged in **195 unlinked tickets that were never escalated to dev** — a 217-row "Needs Linear" queue with no value. `Issue` was removed as a type; a ticket typed `Issue` now enters ONLY through its Linear link. **VERIFIED 2026-08-31 by SQL** over the non-excluded v3 population: **44** Bug/Feature Request/Incident (of which **19** carry no Linear link — the real Needs-Linear queue) plus **25** linked tickets of other types (19 `Issue`, 6 Question/Configuration/untyped) = **69** rows, against 39 under the old type-only gate. A ticket admitted by rule 2 can never appear in "Needs Linear" — being linked is what admits it. 22 tickets qualified at original build time (9 Bug / 13 Feature Request).
- **Search hits outside the current view are now announced (2026-08-31).** Search runs over the whole qualifying population but only the active queue tab and state filter are on screen, so a hit elsewhere used to read as "not found". `matchesSearch()` is factored out and reused to count hits per queue tab (shown on the tab labels while a search is active) and to count hits hidden by the state filter (a hint under the filter bar with a one-click switch to *State: all*). No change to what search indexes.

- **Hub state:** `open → in_progress → fix_shipped → customer_notified`, plus terminal `wont_do`. The board defaults to *active only* (hides the two terminal states).
- **VIRTUAL open rows.** A qualifying ticket renders at `open` with **no row written**. `public.dev_escalations` is only inserted on the first human decision (state change, Linear link, or note) — so the table holds decisions, never a mirror of Intercom. Nothing to backfill, nothing to drift.
- **Linear (phase 1 = LINK ONLY).** The link is resolved in priority order: Hub `linear_url_override` → `custom_attributes."Linear Issue"` → `custom_attributes."Escalated Issue"`. Full `linear.app` URLs and bare `KEY-123` issue keys both resolve; anything else (some `Escalated Issue` values are Slack permalinks) is shown **verbatim and unlinked** rather than guessed at. The override is editable inline per row.
- **Linear phase 2 (LIVE, 2026-08-24) — `sync-linear-escalations`.** Cron `sync-linear-escalations-daily` at **05:50 UTC**, plus an on-demand **Sync Linear** button on the board (editor-gated). **Read-only against Linear**: it never writes to Linear, and in the Hub it writes **only** `linear_key / linear_title / linear_state / linear_assignee / linear_synced_at` — `hub_state`, `note`, `owner` and `linear_url_override` stay human-owned. Keys are resolved with the **same priority chain as the UI**, split into team key + issue number, and looked up one at a time through the connector gateway (`POST /linear/graphql`, `issues(filter:{team:{key:{eq}}, number:{eq}}})`); capped at **200 keys per run**. It **does** insert rows for referenced tickets that have no Hub row yet (`hub_state` defaults to `open`) — a deliberate narrowing of the virtual-open-rows rule, so live Linear metadata does not require a human touch first. A gateway non-200 **aborts the run** and is surfaced with status + body so a bad token can never read as "issue not found"; unresolvable keys are returned in `not_found`. Health key `linear_escalation_sync`. First run: 32 candidates, 30 distinct keys, **27 resolved, 29 rows written, 3 not found** (`AGE-993`, `INTX-1634`, `SCA-2893` — most likely teams the connection's token cannot read; **UNVERIFIED** which). The board renders the mirror only when `linear_key` matches the currently resolved key, so an edited link never shows stale Linear metadata.
- **Schema — `public.dev_escalations`:** `intercom_conversation_id` **UNIQUE** (the join key, upsert target), `hub_state` (CHECK over the five states), `linear_url_override`, `note`, `owner`, `state_changed_at`, `notified_at`, the five phase-2 Linear columns, `created_by`, `created_at`, `updated_at` (shared `update_updated_at_column` trigger). RLS mirrors `esh_backlog_items`: **any authenticated** user selects/inserts/updates; **DELETE admin-only**. `state_changed_at` is stamped on every state write, `notified_at` additionally when moving to `customer_notified`.
- **Table (REDESIGNED 2026-08-26) — two queues, one table on screen.** A segmented control switches between **Needs Linear** (qualifying tickets with no resolvable Linear issue — the safety net for the rule that every bug/feature request gets one; a Slack permalink does *not* count as linked), **Linked**, and **All**; each button carries its filtered count. Columns cut to Intercom ID · Subject · Customer · Type · Linear · Hub state (inline select — the one action taken from the list) · Age, sorted **oldest first**. Contact, Owner, Intercom state, the Linear mirror fields (title / state / assignee / synced-at) and the **Linear override editor** moved into the shared `IssueDetailSheet`, opened by row click, so no table cell flips into an input. The three-line info banner became an **info popover** next to the title; the five hub-state pills became the queue counts; type / owner / customer filters moved behind a **More filters** popover (hub state and search stay on the bar).
- **Dev follow-up tracking (2026-08-31).** `dev_escalations` gains `dev_followed_up_at timestamptz` + `dev_followed_up_by text` — Hub-owned, nullable, never written by any sync. A **Dev follow-up** column sits between Hub state and Age showing `Today` / `Nd ago` with the date underneath, and `Never` when no one has chased Dev yet; sorting treats `Never` as the *oldest* so rows needing a chase surface first. The detail sheet carries a **Last followed up with Dev** field with editor-gated **Mark followed up now** / **Clear** buttons, stamped with the signed-in user's email. Nothing is written to Linear or Intercom.
- **Notes live on the ticket, not the board (2026-08-26).** `dev_escalations.note` was a single overwritable text field that **nothing else in the app read**, so a note written here vanished when the ticket was found anywhere else. Notes are now rows in **`public.conversation_notes`** keyed by the **v3 ticket uuid** with `conversation_source = 'intercom_v3'` — threaded, authored, timestamped, and portable to any surface that reads v3 notes. Component `src/components/issues/TicketNotes.tsx` (list + composer, author reused from `localStorage.note_author`, ⌘+Enter to save, delete per note), with `fetchV3Notes(ticketIds)` batch-loading the whole visible population in one query so the detail sheet opens populated and page search can index note text. `dev_escalations.note` is **retained but no longer read or written** — the deliberate rollback path. One-time copy ran 2026-08-26 and moved **0 rows** — **VERIFIED**: 0 of 33 `dev_escalations` rows carried a note, so nothing was lost and nothing needed migrating.


### Shared issue-view template — `src/components/issues/*` (PRESENTATION ONLY)
**Why:** the v3 ticket views had drifted. Inbox v3 already used a clickable Intercom ID chip plus a row-click detail sheet, while Prospects / Triage / Escalations used a trailing `ExternalLink` icon, had no row interaction, and each page carried its **own** copy of the Intercom deep-link helper and its **own** `accountLabel` map — so the same `customer_key` could render differently depending on which page you were on.

- **`src/lib/intercom.ts`** — `intercomUrl(id)`, the single canonical Enterprise-inbox deep link.
- **`src/hooks/useCustomerLabels.ts`** — one `customer_key → label` resolver (handles `prospect_unmapped`, `prospect_personal`, `domain:*`, unattributed), replacing the per-page maps.
- **`src/components/issues/IssueTable.tsx`** — generic `IssueTable<T>` + `IntercomIdChip` + row-click support.
- **`src/components/issues/issueColumns.tsx`** — column factories: `idColumn`, `subjectColumn`, `contactColumn`, `customerColumn`, `ownerColumn`, `ageColumn`.
- **`src/components/issues/IssueDetailSheet.tsx`** — the standard read-only detail overlay.
- **Canonical column order:** Intercom ID (chip; click opens Intercom, `stopPropagation` so it never fires the row) · Subject · Contact · Customer · Owner · page-specific columns · **Age last**.
- **Applied to:** `/prospects` and `/triage` (fully migrated — Triage gained a detail sheet it never had), `/escalations` (migrated with its inline Hub-state select, Linear override input and note editor living inside the shared cells), and **Inbox v3** (keeps its own table blocks but uses the shared `intercomUrl` + `IntercomIdChip`; the Transferred table's ID column moved to first position).
- **SCOPE FENCE:** presentation only — no query, population, engine, policy or write-path change on any page. Row sets and numbers are unchanged.











#### SLA policy config — admin-editable, effective-dated targets (schema + engine + `/sla-policy`)

**WHY (design intent, not mechanics).** Leadership's verdict that **Sev 1 wall-clock 24/7 was too aggressive** exposed the real problem: SLA targets lived in `slaMetrics.ts`, so changing a number meant a code change, and every historical figure silently re-scored against the new value with no record of what the commitment *was* at the time. Targets and business hours therefore moved **out of hardcoded engine constants and into ADMIN-EDITABLE, EFFECTIVE-DATED DATA**.

- A **policy version** is an **immutable snapshot**: all targets + business hours + `effective_from` + `status`.
- A ticket is scored against the **version in force at its INBOUND ANCHOR** (`slaClockStartS`, else `created_at`) — *the SLA that was in force when it arrived*. **One version per ticket, no mid-ticket switching.**
- **`provisional`** versions may be edited and re-score history freely — that is calibration, and **that is where we are today**.
- **`committed`** versions are intended to become immutable once their effective date passes (contractual — you cannot retroactively move goalposts). This is the mechanism by which the previously-provisional targets get **ratified**.

**Schema (migration; RLS: `SELECT` for `authenticated`, all writes `has_role(auth.uid(),'admin')`).**

- **`public.sla_policy_versions`** — `id`, `effective_from timestamptz`, `status text CHECK IN ('provisional','committed')`, `business_hours jsonb` (`{ tz, work_days[], day_start_hour, day_end_hour, holidays[] }`), `label`, plus audit (`created_by`, `created_at`, `updated_by`, `updated_at`).
- **`public.sla_policy_targets`** — `version_id → sla_policy_versions.id`, `metric text CHECK IN ('first_response','resolution','cadence','triage')`, `severity` (1–4; **`NULL` for triage**, which is severity-agnostic), `target_seconds` (**`NULL` is meaningful: an explicit "no target"**, never "unset"), `clock text CHECK IN ('business','wall')`. Uniqueness: `UNIQUE (version_id, metric, severity)` plus a **partial unique index** on `(version_id, metric) WHERE severity IS NULL` — Postgres treats `NULL` severities as distinct, so the triage row needs its own guard (and is upserted match-then-write, not via `onConflict`).
- **Vocabulary mapping:** the DB clock vocab is **`'business' | 'wall'`**; the engine's is **`'business' | 'calendar'`**. `policyToEngine` translates `wall → calendar`.

**Current live state** — exactly one version, `provisional`, `effective_from 2026-01-01T00:00:00Z`, label *"Seed from code constants (provisional)"*. Its target values and business hours are documented in the table under *"Compliance evaluation — policy targets (DATA)"* above (Sev 1 FR and Sev 1 cadence are now **business** clock, deliberately drifted from the code constants).

**Engine (`src/lib/slaMetrics.ts`).**

- **`policyToEngine(versionRow, targetRows)`** maps DB rows to the engine shapes (`SlaTargets`, `CADENCE_TARGETS`-shaped map, `triageTargetS`, `BusinessHoursConfig`), translating `wall → calendar`. **`resolvePolicy(anchorMs, policies)`** returns the latest version whose `effective_from <= anchorMs`, or `null` if the anchor precedes every version.
- **Business hours are injectable**: `businessHoursBetween`, `businessDaySeconds` and `formatBusinessDuration` take an optional config / business-day length, **defaulting to `DEFAULT_BUSINESS_HOURS`** (built from the old constants — Berlin, Mon–Fri, 09:00–24:00, no holidays). Timezone handling is generic (`Intl.DateTimeFormat`, one cached formatter per tz), so a policy can name any tz.
- **`computeSla(conversation, opts?, businessHours = DEFAULT_BUSINESS_HOURS)`** threads the calendar down into `computeTriage` and `computeCadence`, so every business-hours figure honours the resolved policy.

**Hooks + surfaces.**

- **`src/hooks/useSlaPolicy.ts`** — read-only loader for both config tables; exposes `policies`, `loading`, `error`, `resolveForAnchor(anchorMs)`. It never writes.
- **`src/hooks/useSlaBatch.ts`** — **two-pass** per row: pass 1 computes with the default calendar purely to derive the ticket's **inbound anchor** (a wall-clock timestamp, so it cannot depend on business hours); the anchor resolves the policy; pass 2 **re-computes only when the resolved calendar actually differs** from `DEFAULT_BUSINESS_HOURS`. Each enriched row carries **`policy`** and **`policyFallback`**; the hook also returns `activePolicy` (the version in force *now*, used for target **labels/columns**), `policyFallback`, `policyError`, `resolveForAnchor` and `policyConfigLoaded`.
- **`SlaReport` / `SlaDashboard` / `SlaWorkbench`** score every row against **`row.policy`** (`evaluateCompliance(sla, sev, row.policy.targets)`, `evaluateTriage(sla, row.policy.triageTargetS)`, `evaluateCadence(sla, sev, row.policy.cadence[sev]?.maxGapS)`), and label columns from `activePolicy`.
- **`src/components/sla/PolicyFallbackBanner.tsx`** — **LOUD** banner rendered on all three surfaces whenever the config failed to load, is empty, or a ticket predates every version, stating plainly that the numbers came from the built-in engine constants. Charter rule: never silently default.
- **`/sla-what-if` still reads the constants** — the sandbox baseline has not been cut over yet.

**Admin panel — `/sla-policy` (`src/pages/SlaPolicyAdmin.tsx`, Admin flyout).** Admin-gated in three places: nav (`adminOnly` on the `NavChild`, filtered by `useIsAdmin`), route (non-admins get a "Not authorized" card), and save controls (only rendered for admins) — with **RLS as the authoritative gate**. v1 editing model: **edit the single provisional version IN PLACE** (no new-version creation yet). Target grid = Sev 1–4 rows × First Response / Resolution / Cadence columns, plus a single Triage row; each cell takes a duration and a clock, and an empty value means the explicit **"no target" `NULL`**. Business-hours editor covers timezone, working days, day start/end hour and a holidays list. Validation is loud and blocking (bad durations, start ≥ end, malformed holiday dates).

**Known-not-yet (documented so nobody assumes otherwise).**

- **Holidays are stored but the engine does not consume them** — `businessHoursBetween` reads `config.holidays`, and the live version's list is empty; the UI says so.
- **`/sla-what-if` baseline is still the constants**, not the policy.
- **"Commit / go-live" enforcement and future-dated versions are a later addition.** The schema already supports both (`status`, `effective_from`, per-anchor resolution); nothing yet blocks editing a `committed` version or creating a second version from the UI.


#### Monthly SLA Report — `/sla-report` (`src/pages/SlaReport.tsx`) — target PROPOSAL

Third SLA view (protected route, nav link "SLA Report"), shipped in commit `7a2810d`. **Strictly read-only and additive**: it reuses `useSlaBatch` / `computeSla` / `evaluateCompliance` / `aggregate` / `SLA_TARGETS` and `rowClosedAtMs` (from `src/lib/slaWindow.ts`) — **no engine, hook, resolver or target changes**.

**Why it exists (the framing — this is the anti-drift anchor):** this report is a **DATA-BACKED TARGET *PROPOSAL*, not a compliance scorecard.** `SLA_TARGETS` is explicitly PROVISIONAL / unratified, so the report inverts the usual emphasis: the **distribution stats (Median / p90) are the headline EVIDENCE** for where targets could reasonably be set, and every "% met" is labelled **"vs PROPOSED target"**. A top banner states it verbatim: *"Proposed SLA targets — performance baseline for calibration, not committed-SLA compliance."* The what-if / slider view in the backlog is the natural live companion; this static monthly report is its precursor and the artefact used to argue the numbers in a meeting.

**Population & window:** ALL Enterprise finalized/reopened tickets from the hook's `inScope` bucket — **no owner filter** (deliberately different from the owner-scoped operator views). Month selector offers the last 12 months and defaults to the **current calendar month**; membership is **finalized-in-month**, computed with `rowClosedAtMs(row)` against `[monthStart, nextMonthStart)`. (Created-in-month is a noted future option.)

**Sections:**

- **§1 Scope & Population** — in-scope population count; **exclusion breakdown by reason** (`not_enterprise`, `enterprise-fyi`+`enterprise-duplicate`, `merged_ticket`, `rsa_override = false`, `test_account`, `prospect_personal`, `enterprise_prospect`, plus `other` when non-zero — display-only mirror of `classifySlaBatchRow`'s predicates); `noCustomer` and `manuallyLogged` counts; and a **severity reconciliation** list that must add up: `population = Sev1 + Sev2 + Sev3 + Sev4 + Unclassified` with a visible ✓ / ✗ MISMATCH marker. Tickets whose `parseSeverity` is `null` stay **IN the population** and are surfaced in a loud destructive block — *"Unclassified severity: N (missing Severity attribute — cannot be scored)"*. **Why:** never silently drop unscoreable rows; the reconciliation line makes any future drift in the buckets self-evident.
- **§2 Headline** — overall First Response and Resolution %met over all scored in-scope rows, each with met / breach / excused / not-evaluable counts and Median / p90 / Avg beneath it.
- **§2b Triage time — measure-first (no target)** (commit `39c086f`, `SlaReport.tsx`, purely presentational — same month window and same `inScope` population as the rest of the report; no engine change). Evaluable set = rows where `hasSeverityEvent && timeToTriageS != null`. Shows **median / average / p90 / n on wall-clock** (the median is the "single global number"; average is always shown alongside the median per our stats rule), the **business-hours median** as a clearly-labelled secondary (so off-hours arrivals don't read as slow work), a **by-FINAL-severity mini-table** (Sev 1–4 + Unclassified: median / avg / n) plus a count of tickets **re-classified after first triage** (`severityEventCount > 1`), and a measure-first note stating no target is set yet. **HONEST COVERAGE LINE (non-negotiable):** *"Triage measurable for N of M in-scope tickets"* with the explanation that `event_details` capture only starts ~**15 July 2026** — tickets closed before that are **not-evaluable, not fast**, and the evaluable subset is **never** presented as if it were the whole population.
- **§3a First Response by Severity** and **§3b Resolution by Severity** — columns: `Sev · n · Target (clock) · %met (breach / excused) · not-evaluable · Avg · Median · p90`.
- **§4 Breaches vs PROPOSED targets** — FR and Resolution breach lists (ticket subject with Intercom deep link, customer label, severity, actual, target + clock, breach/excused badge) plus the **override rate** ("X of Y excused") for each metric, so excusing can't quietly inflate the headline.
- **§5 By Source** — Slack / Sam-first / Direct (`origin === "slack"` → Slack, else `sla.flags.samParticipated` → Sam-first, else Direct): n, FR %met, Res %met, FR+Res Avg and Median, and **pre-inbox median**.
- **§6 Data-Quality Footer** — severity coverage %, exclusion / no-customer / manually-logged counts, not-evaluable counts, plus the standing caveats (targets provisional; no trend line in the first reporting month; Sam-anchored tickets measure post-handoff time only with pre-inbox reported separately; Sev 4 resolution best-effort).

**COUNTING RULES (the credibility core — document precisely):**

- **`%met = met_true / (met_true + breach)`**, where `breach` counts only **unexcused** breaches (an excused breach is one with a matching row in **`sla_violation_overrides`** — the single consolidated override table — via the hook's `isExcused(cid, metric)`, `metric ∈ triage | first_response | resolution | cadence`).
- **Excused AND not-evaluable are BOTH excluded from the denominator** and shown as their own visible counts. *Why:* they are different kinds of "not a data point" (a judged exception vs no measurable value) and folding either into met-or-breach would silently move the headline.
- **Sev 4 Resolution has no committed target** → rendered "no target (best-effort)", no %met, but Avg / Median / p90 still shown for visibility.
- **Clock basis is per severity, not blanket:** **Sev 1 = calendar / 24-7**, **Sev 2–4 = Berlin business hours**. The headline basis is therefore worded "each severity's committed clock", never "business hours".
- **FR BASIS = CUSTOMER-INITIATED, on ALL pages** (commit `91ae443`). Every First-Response tally on **Dashboard, Report and Workbench** counts only rows where `sla.initiatedBy === "customer"`. **Agent-initiated tickets** (we opened them — outbound, CSM relay, forwarded email) are excluded from First Response because **there is no customer waiting**, so "first response" is meaningless there. **Resolution always covers all in-scope tickets.** _Why it's called out:_ `SlaReport` originally computed FR over ALL initiations while the Dashboard used customer-initiated only, so the two surfaces disagreed on the same month; the fix made the basis identical everywhere and the wording explicit on each surface.

**Test data:** renders the same shared `TestDataToggle` + `TestDataBanner` (imported from `SlaWorkbench.tsx`), default OFF — test-account tickets are excluded from the population unless the toggle is ON, exactly as on Dashboard/Workbench.

### Where these surfaces live in the nav (regroup `b5b66e0`)

The left nav is grouped **by use**, not by feature family, so the SLA surfaces are deliberately split: **SLA Report** sits under *Reports*, **SLA Dashboard** under *Dashboards*, **SLA Workbench** under *Tools*; **Customer report** is a standalone top-level link. The family name is kept in each child label so it's still findable by reading. Full rationale and mechanics in §19 "Left-nav information architecture".

### The three SLA surfaces — division of labour (reorg `f3bb52f`)

One engine, one hook (`useSlaBatch`), three purpose-built pages:

| Route | Audience | Window | Contains |
|---|---|---|---|
| **`/sla`** (`SlaDashboard.tsx`) | live **OPS** view | rolling window | population/coverage chips, per-severity compliance scorecard, per-severity breach badges, "how these are measured" popover. Links out to the Workbench to investigate or override. |
| **`/sla-report`** (`SlaReport.tsx`) | leadership, the **formal monthly report** | one **calendar month** (finalized-in-month) | lean layout: proposal banner → §1 scope & population (+ loud Unclassified block) → §2 headline `%met` + met/breach/excused/not-evaluable counts → §2b triage time (measure-first, no target) → §3a/§3b by-severity scorecard with Avg/Median/p90 → §4 breach **summary** + Workbench link → §5 lean by-source → §6 caveats. **A data-backed PROPOSAL** — `SLA_TARGETS` is provisional. |
| **`/sla-workbench`** (`SlaWorkbench.tsx`) | practitioners | filterable (window / customer / frBasis) | per-ticket tables, the **unified Violations table** covering First response · Resolution · Triage · **Cadence**, with excuse / remove (the only place **`sla_violation_overrides`** is written, and writes are **admin-only**; excused rows render the override **reason AND free-text note inline** beneath the "Excused · {reason}" chip — muted italic, quoted, truncated with the full note preserved in a `title` tooltip; commit `daebf72`, UI-only in `ExcuseCell`), **Work-Before-Ticket card**, **Excluded-by-reason card**, by-source breakout, KPI tiles, live Analyze-by-ID. |
| **`/customer-report`** (`CustomerReport.tsx`) — **experimental prototype** (Beaker nav, out to CSMs for feedback) | **CSMs**, per-customer | preset range (This month default / Last month / 30d / 90d) | one customer at a time: summary stat cards (open, closed, FR %met, Res %met, breaches, CSAT) + Escalated-to-Dev / Open issues / Closed issues tables. Reuses `useSlaBatch` + `evaluateCompliance` — no new SLA computation. |

##### Shared SLA date-window (`src/lib/slaWindow.ts`)

The "Window" selector on **`/sla` (SlaDashboard)** and **`/sla-workbench` (SlaWorkbench)** — which also scopes the breach cards — is driven by one shared module: `DateWindow`, `WINDOW_LABELS`, `WINDOW_CAPTIONS`, `windowRange`, `windowStartMs`, `rowClosedAtMs`. Both dropdowns render `Object.keys(WINDOW_LABELS)`, so options appear on both pages automatically.

Options: `7d` · `30d` · `90d` · `month` ("This month") · **`last_month` ("Last month", caption "resolved last month")** · `all`. `last_month` renders **right after** "This month".

**`last_month` is the first BOUNDED window** — the previous **calendar** month, `[first-of-previous-month → first-of-this-month)`, **end exclusive**. All other windows are open-ended "since X → now".

- `windowRange(w, now)` returns `{ startMs, endMs }`: `all` → `{null, null}`; `7d`/`30d`/`90d` → `{ now − Nd, null }`; `month` → `{ first-of-this-month, null }`; `last_month` → `{ first-of-previous-month, first-of-this-month }`. `endMs` is **null for every window except `last_month`**.
- `windowStartMs(w, now)` is kept and now simply delegates to `windowRange(w, now).startMs`, so pre-existing callers are unaffected.
- The close-date filters in `SlaDashboard.tsx` and `SlaWorkbench.tsx` apply **both** bounds: keep a row when `(startMs == null || closeMs >= startMs) && (endMs == null || closeMs < endMs)`. Because `endMs` is null elsewhere, every pre-existing window behaves **exactly as before**.

**WHY:** a monthly review needs the previous **completed** calendar month; "This month" is partial and the rolling windows straddle month boundaries. `/sla-report` already offered last month through its own `monthOptions` dropdown — this closes the same gap on the Dashboard and Workbench breach cards. UI/filter-only: no engine, hook, target or schema change.



#### Customer Report — `/customer-report` (`src/pages/CustomerReport.tsx`) — experimental prototype

A per-customer SLA + volume view for CSM-style consumption. Route in `App.tsx`, nav entry in `AppLayout` flagged experimental (Beaker icon).

**Audience / why the shape:** CSMs do **not** have Intercom access, so **all** detail is self-contained in-app. Intercom conversation IDs render as **plain selectable text** (so a CSM can quote the id to support), deliberately **not** deep-links. The one external link on the page is the **Escalated Issue (Linear)** — the actual escalated-issue reference.

**Numbers reuse the engine:** consumes `useSlaBatch` + `evaluateCompliance` (**not** a new SLA computation), so every figure matches the Dashboard/Report exactly. Currently-open counts come from a light `intercom_tickets_v3` query (`lifecycle_status ∈ open / reopened_after_finalize`) by `customer_key`; the customer list comes from `v3_customer_accounts` (excludes `is_test`).

**Filters:** searchable customer combobox; date range (This month **default** / Last month / 30d / 90d, applied to closed rows via `finalized_at` / `closed_at`); "Show closed issues" toggle, **default off**.

**Summary cards:** Currently open (per-severity mini-breakdown) · Closed in range (per-severity mini-breakdown; **Unclassified shown only when >0** and styled as an anomaly — closed tickets should always be classified) · First Response met % (**customer-initiated** scope) · Resolution met % · Breaches · CSAT positive (% of ratings 4–5 on the 1–5 scale; the description carries the response **count** and the average).

**Escalated to Dev table** — independent of the Show-closed toggle; **always** shows open **and** closed escalations. Criteria: `Escalated to Engineering = Yes` **OR** `Ticket type ∈ {Bug, Incident}`. Columns: Subject · Intercom ID · Severity · Type · Esc→Eng · Linked issue · State · Created. **Linked issue** reads the **`Escalated Issue`** custom attribute (legacy `Linear Issue` fallback) and renders a clickable Linear link showing the issue id (e.g. `ENT-2804`). _Deliberate:_ it does **not** scrape notes for Linear URLs — a URL in a note may be a related investigation, not the filed issue.

**Open issues table** (always): Subject · Intercom ID · Severity · Created · Last activity (`intercom_updated_at`) · State — no outcome columns, because open tickets have no resolution yet.

**Closed issues table** (only when Show-closed is on): Subject · Intercom ID · Severity · Created · Resolved · First Response (value + met/breach) · Resolution (value + met/breach).

**Status:** experimental prototype, out to CSMs for feedback.



**Excused-breach note surfacing (`daebf72`, Workbench-only):** override `note` values used to live only in a native `title=` hover on the "Excused" chip — invisible on touch, no affordance, so a human who wrote a note had no reliable way to read it back ("captured but invisible" gap). `ExcuseCell` now renders the note inline (muted italic, quoted, truncated) directly beneath the "Excused · {reason}" chip on both the First-Response and Resolution breach tables, with the full note kept in a tooltip for long text. UI-only change — no schema, hook, query or engine touched. The Dashboard (`/sla`) is intentionally NOT changed: it stays aggregate and shows only an "excused" count.

**What moved in the reorg:** Work-Before-Ticket and the per-reason exclusion table came **off** the Report and onto the Workbench; the Report's §2 dropped Median/p90/Avg (those are per-severity evidence, not a rollup number) and §4 dropped per-ticket breach tables for a summary + link. Principle: **leadership reads outcomes, practitioners read detail** — and any given number lives in exactly one place.

### Caveats to keep in mind when reading numbers


- **OPEN tickets (~10 %) are excluded** from Batch — the snapshot doesn't store `conversation_parts` for them, so `computeSla` can't run. Resolution numbers are therefore **optimistically biased**: worst / longest-tail cases are missing.
- **Holidays not modeled** — the policy version carries a `holidays` list, but it is empty and the engine does not consume it yet; business hours treat every configured workday as a full day (currently Berlin Mon–Fri, 15 h).
- **Targets are provisional / unratified** — the single live policy version is `status='provisional'`, so it may be edited and history re-scores freely. Ratification = a `committed` version. Plumbing (now admin-editable data), not yet policy.

- **Pre-inbox time mixes Sam handling with pre-ticket Slack work** — future split noted.
- **Forwarded customer emails from our shared `@lovable.dev` inbox** misclassify as agent-initiated. Accepted; will be corrected by manual override.

### Known open items

- **Split pre-inbox time** into "Sam-first (excluded handling)" vs "Slack-native (pre-ticketization)".
- **No-customer / CSM-in-the-middle tickets**: whether these belong in their own pool with a count-KPI (currently just bucketed as `noCustomer` and excluded from compliance).
- **Stored-payload completeness for Slack**: for Slack-originated tickets the stored `raw_payload` may be less complete than a live Intercom fetch — the live tab remains authoritative per-ticket.
- **Manual initiation-override** to correct forwarded-email misclassification.
- **Holiday-aware business-hours calendar** — holidays are already stored on the policy version; the engine needs to consume them.
- **Commit / go-live flow for policy versions** — creating a future-dated version and freezing `committed` ones once their effective date passes (schema supports it; UI/enforcement pending).
- **`/sla-what-if` still baselines on the engine constants**, not the live policy version.
- **TECH DEBT — rollup logic is duplicated per page.** Each of the three SLA pages carries its own `computeStats`/scorecard code over the same `useSlaBatch` spine, and Dashboard vs Report overlap heavily. Until a shared rollup module exists, **any counting-rule change must be applied to all three pages in lockstep** — the FR-basis drift fixed in `91ae443` is exactly the failure mode this duplication produces.
- **Retire `settings.admin_owner_map`** and repoint its 7 legacy readers at `public.teammates`.
- **Aggregate dashboard + SLA compliance slider** — plumbing is in place; UI wiring TBD after target ratification.

---

## Backlog — in-app team work tracker (`/backlog`)

Migration `eba8ac3` (table) + page `bc367f1` (`src/pages/Backlog.tsx`), reachable from the **Tools** nav flyout.

### Purpose / WHY

A single-pane, team-facing tracker of **all** outstanding ESH work — bugs, to-dos, tech debt, feature requests and strategic items — in one place instead of scattered across Slack threads, docs and heads. It is deliberately a **first small step toward the team actually WORKING inside ESH** (the "ESH work-tickets pivot" direction): it is team-writable to drive adoption, and the `assignee` field exists to nudge explicit ownership rather than diffuse "someone should".

### Table — `public.esh_backlog_items`

`title` (NOT NULL), `description`, `category`, `status`, `priority`, `area`, `assignee` (teammate email; **NULL = unassigned**), `linked_ref` (free text — ticket id / commit sha / Linear id / URL), `source` (provenance for seeded items), `created_by`, `created_at`, `updated_at` (bumped by the shared `update_updated_at_column()` trigger).

CHECK constraints:
- `category ∈ (bug, todo, tech_debt, feature_request, strategic)`
- `status ∈ (open, in_progress, blocked, done, wontfix)` — default `open`
- `priority ∈ (high, med, low)` **OR NULL**

### Charter alignment

- **Bad values are rejected LOUDLY.** The category/status CHECKs make a typo'd or invented bucket fail the write rather than silently mis-bucket an item.
- **`priority IS NULL` is an explicit "Unprioritized" state**, never defaulted — an unprioritized item must look unprioritized, not quietly "med".
- **Dismissals use `wontfix`, not deletion** — nothing is silently lost; a rejected idea stays auditable with its reasoning.
- **Permissions:** SELECT / INSERT / UPDATE open to any authenticated teammate (team-writable on purpose); DELETE **admin-only** via `has_role(auth.uid(),'admin')` — the same admin check gating the customer Registry and Teammates writes. The UI hides the delete control for non-admins, but RLS is the enforcement.

### UI — `src/pages/Backlog.tsx`

- Per-category **open-count strip** (counts exclude `done` / `wontfix`).
- Filter row: category / status / priority / assignee / free-text search, plus a **"show done & won't fix" toggle that is OFF by default**.
- Collapsible per-category sections, rows sorted **priority → `updated_at`**; rows expand for full detail.
- Inline `status` / `priority` / `assignee` edits with toasts; add/edit dialog; admin-gated delete with a confirm step.
- Assignee dropdown is sourced from `public.teammates WHERE active AND role <> 'ai'` — Sam can never be assigned work.

### State

The table is currently **EMPTY** and the page renders its empty state. A ~38-item inventory of known outstanding work is compiled and **STAGED**, to be seeded later on Matt's explicit go.

### Known caveats

- `assignee` / `created_by` are free-text emails with **no FK to `teammates`** — the dropdown constrains new writes, but any pre-existing or hand-entered value renders raw.
- The INSERT/UPDATE policies are intentionally always-true (shared team backlog); the linter flags this as permissive. If authorship enforcement is wanted later, UPDATE can be narrowed to `created_by = auth.jwt()->>'email' OR has_role(...)`.


## Working tickets in the ESH — write spine (Step 0/1, 14 Aug 2026)

First step of the "work tickets in the ESH, not only report on them" track. **This step ships no user-visible write** — it is the plumbing plus its safety interlocks, landed and provable before any surface is wired to it.

### Write-through contract (non-negotiable)

The Hub is **not** the source of truth for Intercom-owned fields, and does not become one in this step. Every write follows the same order, and any failure stops it:

1. authenticate the caller, resolve them to a row in `public.teammates`,
2. check the global kill switch and the per-action allowlist,
3. call Intercom **as that teammate's `intercom_admin_id`** and wait for a 2xx,
4. re-read `GET /conversations/{id}`,
5. only then mirror what Intercom actually returned into `intercom_tickets_v3`.

If Intercom rejects, the local row is **left untouched** and the provider's status + body are returned verbatim — the Hub never records a value Intercom refused. If the write lands but the re-read or the local mirror update fails, the caller is told so explicitly and the next sync reconciles; the Hub does not guess.

Attribution runs through the teammate's real Intercom admin id, never a generic bot admin, so `classifyActor` in the SLA engine keeps reading these as `human_admin` and the measurement track stays honest. All five active support teammates already carry an `intercom_admin_id` (verified 14 Aug), so Step 0 needed no data work.

### `supabase/functions/esh-write-action`

The **single** choke point. No other app or function code may call Intercom to mutate a ticket or write the Intercom-owned columns of `intercom_tickets_v3`. Request shape: `{ conversationId, action, payload }`. Actions are an explicit closed set in code (`KNOWN_ACTIONS`) — an unknown name is refused by name, not by shape. Step 1 registers exactly one action, `set_severity` (`custom_attributes.Severity`, values `1`–`4`), and it is **not** callable until it is added to the allowlist.

Two independent interlocks, both defaulting to closed:

- `settings.esh_write_enabled` — global kill switch, `false`. Flipping this off disables every Hub write instantly, no deploy.
- `settings.esh_write_allowed_actions` — `text[]`, empty. An action must be listed here *and* the switch on.

Both refusals log and return `403 {blocked:true}` — a blocked call is a recorded event, not a silent no-op.

### `public.esh_ticket_actions` — append-only audit

One row per **attempt**, whatever the outcome: `intercom_conversation_id`, `action`, `outcome ∈ succeeded|blocked|failed`, actor (`actor_user_id`, `actor_email`, `actor_teammate_name`, `actor_intercom_admin_id`), `payload`, `intercom_status`, `intercom_response`, `error`. Any authenticated user may read; only `service_role` writes; there are no UPDATE or DELETE policies, so the trail cannot be rewritten or trimmed from the app. This log is the evidence base for judging whether a write surface is safe to widen.

### Deliberately not done in this step

No UI writes anywhere — `/triage`'s severity control (Step 2) is the first surface and lands only after this spine is exercised, including the **negative** case (kill switch off ⇒ blocked and logged). No local-only writes to Intercom-owned fields. No authority flip.


## Triage severity control — first Hub write surface (Step 2, 14 Aug 2026)

The first user-visible Hub-originated write, on the smallest possible field: one enum, on tickets that by definition hold no value yet, so there is nothing to overwrite.

`src/components/issues/SeverityWriteControl.tsx`, rendered in the `/triage` detail sheet. It calls `esh-write-action` with `set_severity` and does **nothing** else — no direct Intercom call, no local write to an Intercom-owned column, no optimistic update.

### Refusals are visible, by design

The negative case is the point of this step. A refusal (kill switch off, `set_severity` not allowlisted, caller not mapped to an active teammate with an `intercom_admin_id`, invalid severity) renders inline in the sheet as "Write refused — nothing changed" plus the function's own message. A genuine failure (Intercom rejected, mirror update failed, transport error) renders as "Write failed — nothing changed". Neither is ever a silent no-op, and neither moves the local row.

### Local mirror timing

On success the function has already written Intercom, re-read the conversation, and updated `intercom_tickets_v3`. The page then patches its own in-memory row from the value the function reports Intercom holds, so the ticket leaves the untriaged list immediately instead of waiting up to 5 minutes for `sync-v3-open`. That patch is a *reflection* of a confirmed server state, not an optimistic guess — it only runs after a 2xx.

The queue's own definition is unchanged: a ticket is untriaged when Intercom reports no `Severity`. The header badge changed from "Read-only" to "Severity writes enabled".

### Verification for this step

Positive: set severity from the sheet on a test-account ticket, then on one real triage ticket watched through close. Negative: kill switch off ⇒ inline refusal, no local change, `esh_ticket_actions` row with `outcome = blocked`. Both confirmed against Intercom by re-read before the step counts as done.








## Action center (`/action-center`, 14 Aug 2026)

A read-only landing surface that answers one question: **is anything in the ESH waiting on a human right now?** It replaces the habit of opening five pages to find out that four of them are empty. Top-level nav entry (bell icon), with an aggregate badge on the collapsed rail.

### One registry, two consumers

`src/lib/actionSignals.ts` exports `ACTION_SIGNALS` — a single array that feeds **both** the page and the sidebar badge, so the badge and the page can never disagree. Each entry is `{ id, label, family, route, routeLabel, meaning, load() }`; adding a signal is one entry and nothing else. `src/hooks/useActionSignals.tsx` runs the loaders in parallel and shares the result through `ActionSignalsProvider` (wrapped around the router in `App.tsx`), so the layout badge and the page cost one fetch, not two. Called outside the provider, the hook returns a no-op zero state rather than throwing.

**Context split (9 Sep 2026).** The context object, the `useActionSignals()` hook and the `SignalState` / `ActionSignalsCtx` types now live in `src/lib/actionSignalsContext.ts`; `src/hooks/useActionSignals.tsx` exports **only** the `ActionSignalsProvider` component. Reason: a module that exports both a component and non-component values is incompatible with React Fast Refresh (`hmr invalidate … "useActionSignals" export is incompatible`), which re-evaluates the module and creates a **second** context object. Consumers then read the no-op fallback while the provider writes to the original, and the page reports `0 signals watched · 0 need attention` even though every loader succeeded — a silent lie of exactly the kind this board exists to prevent. Do not move the hook or context back into the provider module. Verified in-browser after the split at 1920px: 14 signals watched, 1 needs attention (Open dev escalations, 50).


### The ten signals

| Family | Signal | Source |
| --- | --- | --- |
| Queues | Unattributed customers | `v3_unattributed_groups()` |
| Queues | Untriaged tickets | `intercom_tickets_v3` open/reopened with no `custom_attributes.Severity` (same predicate as `/triage`) |
| Queues | Open dev escalations | `dev_escalations` where `hub_state NOT IN (customer_notified, wont_do)` |
| SLA risk | First response past target | policy-aware, see below |
| Pipeline | Integration failures | `integration_health` `last_status='error'` OR `consecutive_failures > 0` |
| Pipeline | Stale v3 sync | newest `done` row per kind in `intercom_sync_jobs_v3` |
| Pipeline | Parahelp routing pending | `parahelp_routing_sync` state `pending`/`failed` |
| Pipeline | Registry not published | `settings.notion_registry_changed_at > notion_registry_synced_at` |
| Review | Knowledge doc approvals | `knowledge_documents.pending_content IS NOT NULL` |
| Review | Channel → account proposals | `v3_channel_proposals_pending()` |

### Per-signal mute (28 Aug 2026)

Each signal card carries an **Alert** switch. Turning it off mutes that signal: the loader still runs and the card still shows its live count, but the signal drops out of "Needs attention", stops feeding the sidebar badge (`attentionCount`), and its errors stop counting toward `errorCount`. Muting is a per-browser display preference stored in `localStorage` under `esh.actionSignals.muted` (an array of signal ids) and applied in `useActionSignals.tsx`; nothing is written to the database, so it never suppresses the signal for anyone else. Built because **Open dev escalations** is still an evolving process and was alerting continuously.

**First-response risk is policy-aware, not a hardcoded target.** It loads `sla_policy_versions` + `sla_policy_targets`, resolves the effective policy per ticket by inbound date via `resolvePolicy()`, runs `computeSla()` on that version's business hours, and compares elapsed time on the target's own clock (business vs wall). Unclassified tickets are skipped — that is the Triage signal's job — and tickets carrying a `first_response` row in `sla_breach_overrides` are excluded.

**Shared SLA population (24 Aug 2026).** The exclusion predicate that used to live inline in `classifySlaBatchRow` now lives in `src/lib/slaExclusions.ts` as `isSlaExcluded()`, and both the SLA workbench and this signal call it. Excluded from the SLA population: `rsa_override = false`; `rsa_override` unset with tag `enterprise-fyi` or `enterprise-duplicate`; tag `merged_ticket`; `customer_resolution_method` in `not_enterprise` / `prospect_personal` / `enterprise_prospect`; and tickets on accounts flagged `v3_customer_accounts.is_test`. Before this, a ticket tagged `enterprise-duplicate` could alert on the Action Center card while being absent from the workbench's violations table. Verified 24 Aug 2026: of 51 open severity-classified tickets, 7 are now excluded (including `215475518887389`), 44 still evaluated.

**Stale-sync thresholds** are per job kind: `open_refresh` 60 min, `closed_backfill` 60 min, `gap_scan` 48 h. A kind with *no* completed run at all is treated as infinitely stale, never as healthy.

### Rules the surface is built on

- **No new tables, no writes, no cached counters.** Every count is read live from the same source its destination page reads, so a card and the page it links to cannot drift.
- **A failed loader is an error card, never a zero.** A loader that throws renders in destructive styling with the message shown and is counted separately as "unreadable". A broken query must never look like a clear queue.
- **No thresholds and no mute in v1.** Any count > 0 is attention. No age gates, no severity weighting, no snooze — muting is the feature that makes an alert board lie, and it stays unbuilt until there is a real false positive to mute.
- **Refetch is cheap.** Window `focus` + `visibilitychange`, debounced 300 ms, at most one fetch per 10 s — the same pattern as `/triage`. No interval, no realtime subscription.

### Layout

Signals with a non-zero count (and error cards) hoist into a "Needs attention" block at the top; the rest stay grouped by family below with a `clear` marker. All-clear renders an explicit empty state rather than a blank page.

### Verification state (14 Aug 2026)

All ten signals load and read 0, cross-checked against SQL — 44 open tickets, 0 untriaged, 0 escalations, 0 Parahelp pending, 0 pending docs, 0 unhealthy integrations. The zeros are real, not an over-filtered query. **Not yet observed:** the non-zero path (amber card + rail badge) against live data, because every watched queue is currently empty.

## Auth & endpoint hardening (batch 1)

Batch 1 of the security-scan triage. Scope was deliberately limited to changes that cannot affect a cron job, a webhook, or an existing session.

### Self-signup is closed

Public sign-up is disabled at the auth layer and the "Create account" button is removed from `/login`. This is the load-bearing fix: nearly every RLS policy is `USING (true)` for the `authenticated` role, so the entire access model assumes *an authenticated user is a vetted teammate*. That was only true if account creation was restricted — and it wasn't. New teammates are now admin-provisioned. Leaked-password (HIBP) protection was enabled in the same pass. Existing sessions and Google sign-in for existing users are unaffected.

### Two XSS paths closed

- **`gmail-oauth-callback`** — the `error` query param, the token-exchange payload, the insert error, and the connected email address are HTML-escaped before interpolation. A crafted `?error=<script>` link previously executed in the browser of whoever opened it.
- **ProjectKnowledge markdown renderer** — `renderMarkdown()` now escapes raw text **first** and applies inline `` `code` ``/`**bold**` formatting **second**, through a shared `inlineMd()` helper used by headings, blockquotes, list items, paragraphs, and table cells; fenced code blocks use `escapeHtml` directly. `knowledge_documents.content` is writable by any authenticated user, so unescaped rendering was a stored-XSS path into every teammate's browser.

### Read-function auth

`supabase/functions/_shared/require-user.ts` validates the `Authorization` bearer token via `auth.getClaims` and rejects anything without a `sub` claim. **The anon key is itself a valid JWT but carries no `sub`, so anon-key-only calls are rejected too** — that is the property that matters.

Guarded (all UI-only call sites): `search-intercom-by-email`, `list-slack-users`, `list-slack-channels`, `fetch-thread-messages`, `fetch-gmail-thread`, `intercom-month-stats`, `check-bot-identity`.

### What is deliberately still open

The ~32 mutation/sync/backfill functions. `pg_cron` invokes them with only the **anon key** as bearer, so applying `requireUser()` to them would silently 401 every scheduled job — `poll-gmail`, `poll-intercom-inbox`, `sync-v3-*`, `reconcile-v3-open`, `promote-pending-intercom-links`, `refresh-intercom-csat`, `sync-parahelp-routing`, `integration-health-alert`, `context-reminder`, `backfill-intercom-replies`, `poll-slack-closed-won`. They need a two-path guard (user JWT **or** a cron secret) plus a rewrite of the cron commands, which is its own batch. Slack/Intercom webhook receivers stay unauthenticated by design and must be signature-verified instead.

### Verification (14 Aug 2026)

- **Negative:** all 7 guarded endpoints return `401` with no `Authorization` header **and** with the anon key alone.
- **Positive:** `list-slack-channels`, `list-slack-users`, `check-bot-identity` all return `200` with a real user session token.
- **XSS:** `gmail-oauth-callback?error=<script>alert(1)</script>` renders escaped entities.

## Hub access roster (admin-managed sign-in)

Adding a teammate used to mean a code/console step. It is now a Settings panel, with self-signup still closed.

### Table

`public.hub_members` — `email` (unique, lowercased), `user_id`, `status` (`pending` | `active` | `blocked`), `note`, `added_by`, `first_seen_at`, `last_seen_at`, `provisioned_at`, `blocked_at`, `blocked_by`. RLS: admins manage every row (`has_role`), a member may read only their own. A `BEFORE INSERT OR UPDATE` trigger lowercases the address and raises on any domain other than `lovable.dev`. The 10 pre-existing accounts were backfilled as `active`.

### Edge function

`hub-access-manage` (`verify_jwt = true`), actions `provision` / `block` / `unblock`. It runs `requireUser()` and then an explicit `has_role(caller, 'admin')` check before touching anything, so a signed-in non-admin is refused and cron/anon cannot reach it. `provision` creates the backend account with a random throwaway password; `block` deletes the account and marks the row blocked. Refusals: non-`lovable.dev` address, last remaining admin, blocking yourself, provisioning an already-active or blocked row.

### Sign-in

`/login` gained "Continue as Lovable workspace member", backed by `signInWithLovableWorkspace()` (managed OAuth provider `lovable`, added in `@lovable.dev/cloud-auth-js` 1.1.2 — the project was on 1.1.1). The returned tokens go through `supabase.auth.setSession`, so RLS still evaluates against a real user id. Google and email/password are unchanged.

Provision stays a manual click because with self-signup disabled the auth layer rejects an unknown identity *before* any app code runs — there is no hook to auto-approve a first-time member.

### UI

One admin-only table — `src/components/UsersCard.tsx` on **Admin → Users** (`/users`, `src/pages/Users.tsx`, nav entry `adminOnly`). Moved off Settings on 17 Aug 2026 (Settings keeps a pointer card only); on the same day `AccessCard` and `RolesCard` were merged into this one card and both files deleted — they were rendering the same two queries (`hub_members` + `list_users_with_roles`) twice, with the second table existing only to host the role buttons.

Columns: Email · Status · Roles · Added · Provisioned · Actions. One row per person, keyed by email, sorted by email. The actions cell carries both jobs: access (Provision, Unblock, "Remove access" behind an AlertDialog confirm) and roles (Grant editor / Make read-only / Grant admin / Revoke admin). Role buttons need a backend account, so a `pending` or `blocked` row shows "no account yet" instead. The page renders an "Admin access required" card for non-admins so the route is never blank.

Drift is surfaced rather than hidden: an auth account with no roster row becomes its own visible row with status `untracked`; an active row whose account is gone is named in the amber drift banner.

### Verification (17 Aug 2026)

Negative: 401 with no `Authorization` header and with the anon key alone; explicit refusals for a gmail.com address, self-block, unknown roster row, duplicate provision. Positive: test row `esh-access-test@lovable.dev` (mine) added and provisioned through the UI at 1900px, then blocked — `hub_members` shows `blocked` with `user_id` null and `auth.users` has 0 matching rows.

Merge check (17 Aug 2026): `/users` at 1900px renders exactly one table with 11 rows, matching SQL (11 `hub_members` + 0 untracked accounts). A temporary `pending` row (`zz-verify-pending@lovable.dev`, mine, deleted afterwards) rendered Provision + Remove access with role buttons replaced by "no account yet". Still unproven: the `untracked` row branch (no such account exists) and the last-admin disabled tooltip (two admins exist; no real admin was revoked to force it). Also still unproven: a real first-time workspace member completing the sign-in path against a provisioned account.


## Editor vs read-only roles

CSMs joining the Hub need every report and inbox view but must not change data. The model is deny-by-default on writes only: reads are untouched.

### Roles

`app_role` gained `editor`. `public.can_edit(_uid uuid)` (security definer, same pattern as `has_role`) returns true for `editor` **or** `admin`. All 11 pre-existing accounts were backfilled as `editor` in the same migration, so no existing teammate lost a capability.

### Enforcement

- **RLS** — the 32 write policies that were open to any `authenticated` user now require `can_edit(auth.uid())` in `USING` / `WITH CHECK`. Read policies unchanged.
- **Edge functions** — `supabase/functions/_shared/require-editor.ts` guards the 9 user-invoked mutators: `esh-write-action`, `post-reply`, `delete-conversation-mapping`, `delete-slack-message`, `create-intercom-from-import`, `import-intercom-ticket`, `import-slack-thread`, `bulk-import-intercom`, `bulk-import-slack`. Cron/webhook functions are deliberately untouched — they authenticate with the anon key and would 401.

### UI (honesty layer, never the enforcement)

`src/hooks/useCanEdit.ts` mirrors `useIsAdmin`. `EditorRoute` wraps the pages that exist purely to change data — Triage, Dev escalations, Import, Bulk import, Test review, Backlog, Settings, Float coverage, Flow, Knowledge — and renders a "Read-only access" card instead of a fully disabled surface; those nav children are `editorOnly` and hidden. `ReadOnlyBanner` appears on the view-and-edit surfaces (Inbox, Conversation detail, Inbox v3, Customers). `SeverityWriteControl` renders a static severity line for read-only accounts rather than a control that would refuse.

Role controls (**Grant editor** / **Make read-only** / **Grant admin** / **Revoke admin**) sit in the actions cell of the single Users table on `/users` (`src/components/UsersCard.tsx`); admins show "editor implied". The last-admin delete trigger is unchanged.

### Verification (17 Aug 2026)

Positive path only: `/users` renders the editor controls, `/triage` and `/changelog` render for an editor+admin account, typecheck clean at 1900px. **UNVERIFIED:** the read-only branch — `EditorRoute` card, `ReadOnlyBanner`, RLS refusal — because no account without `editor` exists yet.

## Owner and product area writes — Step 3 of the write spine (17 Aug 2026)

The second Hub write surface, and the first one that can overwrite a value that already exists. Two actions on the same choke point (`esh-write-action`), two different Intercom mechanisms:

- `set_owner` — a real Intercom **assignment**: `POST /conversations/{id}/parts` with `message_type=assignment`, `admin_id` = the human performing it, `assignee_id` = the target teammate's `intercom_admin_id` resolved from `public.teammates`. An owner with no active teammate mapping is refused, so the Hub never holds an owner Intercom's own assignment contradicts.
- `set_product_area` — `PUT /conversations/{id}` writing `custom_attributes["Affected Product Area"]`, the exact key `_shared/v3.ts extractFields` reads. The value must appear in `settings.product_areas`; the Hub never invents a taxonomy value.

### Strict conflict checking

Unlike Severity, these fields may already hold a value and `sync-v3-open` can move them under the operator between page load and click. Every write carries `expectedCurrent` (the value the UI displayed; `null` means "was empty"). The function **GETs the conversation first** and compares. On mismatch it writes nothing and returns `409 {blocked:true, stale:true}` with `Intercom now holds X (you saw Y)`; the control renders "Write refused — the ticket moved" and tells the operator to reload rather than retry. Last-write-wins was explicitly rejected.

### Mirror

Read exclusively off the post-write verification GET, never off the request payload: `product_area`, `admin_assignee_id`, and `owner` derived through `settings.admin_owner_map` — the same derivation `sync-v3-closed` uses, so the next sync agrees instead of flapping. Intercom's `0` for unassigned is stored as `NULL`.

### Interlocks

Unchanged and still default-closed: both action names are in `KNOWN_ACTIONS` but are **not** in `settings.esh_write_allowed_actions`, so they refuse with `403 {blocked:true}` until explicitly enabled. `esh_write_enabled` remains the global kill switch, and `require-editor` still gates the caller.

### Verification status

Code deployed; **NOT yet exercised live**. Pending: allowlist entry, then the three negative tests (not-allowlisted refusal, stale-value 409 on a field changed in Intercom after page load, unmapped-teammate refusal) plus one live write/revert on a designated test ticket.

## Ticket type writes + Intercom-sourced field options (18 Aug 2026)

### Third write action

`set_classification` joined `set_owner` / `set_product_area` on the same choke point: `PUT /conversations/{id}` writing `custom_attributes["Ticket type"]`, mirrored into `intercom_tickets_v3.classification` off the verification GET, with the same strict `expectedCurrent` conflict check. `TicketTypeWriteControl` (`src/components/issues/TicketFieldWriteControls.tsx`) renders it in the `/triage` and `/inbox-v3` detail sheets.

`settings.esh_write_allowed_actions` was widened the same day to `["set_severity","set_owner","set_product_area","set_classification"]`. The refusal that preceded it (`Action 'set_owner' is not in the allowlist`) was the interlock working, not a bug — the allowlist entry is deliberately a separate data change from the deploy.

### Why a cache and not a hardcoded list

Product area and ticket type are Intercom-owned dropdowns. Pinning their values in Hub code means the Hub silently disagrees with Intercom the moment someone edits the dropdown there. Three options were weighed — hand-maintained allowlist, live fetch per write, cached mirror with drift detection — and the cached mirror won: no hardcoding, no per-write latency, and divergence becomes *visible* rather than a rejected write nobody can explain.

### `public.intercom_field_options` + `sync-intercom-fields`

Cron `sync-intercom-fields-daily` at 05:20 UTC reads `GET /data_attributes?model=conversation`, keeps the two list attributes, and upserts `(attr_key, option_value, sort_order, active, first_seen_at, last_seen_at)`. Options that vanish from Intercom are marked `active=false`, never deleted, so a value still sitting on historical tickets stays explainable. The job registers in `integration_health`, so a failing or stale cache alerts like any other pipeline.

### Phase 2 cutover — the cache is the only source of truth in the write path

`esh-write-action` now validates `set_product_area` and `set_classification` against the **active** rows of `intercom_field_options` only. `TICKET_TYPE_VALUES` and `settings.product_areas` are no longer consulted there, and there is **no fallback**: if the cache holds no active options for a field, the write is REFUSED rather than validated against a stale guess. The same cache populates the dropdowns, so the UI cannot offer a value the function would reject.

`settings.product_areas` still exists because older, non-write surfaces read it. `IntercomFieldOptionsCard` on Settings therefore shows Ticket type as Intercom-sourced (no drift comparison — the cache *is* the list) and keeps comparing Product Area against the legacy list, surfacing the gap instead of hiding it. Action center signal `intercom_field_drift` fires on that gap and links to `/settings`.

### Verification (18 Aug 2026)

- Cache holds 20 active `Affected Product Area` options and 6 `Ticket type` options, read live from Intercom.
- Settings card renders both, and the Product Area drift (18 in `settings.product_areas` vs 20 in Intercom) is shown, not smoothed.
- Negative tests run live against the write endpoint: a legacy-list-only product area (`SSO`) → `400 {blocked:true}` "must be one of the options Intercom offers"; an invented ticket type → `400 {blocked:true}` listing the six cached values. Earlier the same day, the stale-value `409` and not-allowlisted `403` paths were also exercised live.
- **UNVERIFIED:** the empty-cache refusal branch (no run has ever seen an empty cache) and a successful `set_product_area` / `set_classification` write of a cache-only value that does not exist in `settings.product_areas`.
- Note surfaced, not fixed: some historical tickets carry `product_area` values (e.g. `Remix/transfer`) that are **not** in Intercom's current active option list. Writes can no longer produce them; existing rows are untouched.

### Action center evidence links

The first-response-risk card now lists the offending `intercom_conversation_id`s (up to 5, then `+N more`) as direct Intercom links, instead of only linking to the SLA workbench. This was a *diagnosis* change, not a behaviour change: one flagged ticket (#215475496571177, AI-only replies on a snoozed conversation) was not enough evidence to change what the signal measures, so the signal was left alone and made investigable.

## AI severity proposals (18 Aug 2026)

An AI reads a ticket and proposes a Severity 1–4. It is a **proposal layer only** — the model has no write path to Intercom. Severity still reaches Intercom exclusively through `esh-write-action`, on an explicit human click, exactly as it did before this feature existed.

### Two passes, one function

`propose-severity` (edge function, `google/gemini-3-flash-preview` via the Lovable AI gateway) accepts `{ ticketIds: string[] (1..25), pass: "triage" | "reclassify" }`.

- `triage` — deliberately limited input (~4k chars: source message + first replies). This is the pass that runs while a ticket is still untriaged.
- `reclassify` — the same ticket re-scored later against the fuller thread (~12k chars).

Prompt input = the active rubric body + few-shot examples selected from past **human** decisions (accepted and overridden alike, so corrections teach) + the trimmed conversation. Output is structured: severity, confidence, rationale, and a short verbatim evidence quote.

### Cost is bounded on purpose

Four independent brakes, because an always-on classifier is the easiest way to spend money invisibly:

1. `settings.severity_ai_enabled` — kill switch.
2. `settings.severity_ai_daily_call_cap` (default 200) — counted against `severity_proposals` rows created today; the response reports `remainingToday`.
3. Max 25 ticket ids per call.
4. **Content hash** — each proposal stores a hash of the exact text sent to the model. A re-run over an unchanged ticket returns the existing proposal with `skipped: "unchanged"` and makes no model call.

No cron. Every call is a human clicking something.

### `public.severity_rubric_versions` and `public.severity_proposals`

The rubric is versioned, with a partial unique index allowing exactly one `active` row. Saving an edit retires the current version and inserts the next; proposals keep the `rubric_version` that produced them, so a later rubric change never rewrites history.

`severity_proposals` is the ledger: proposal, rationale, evidence, confidence, model, input/output tokens, `content_hash`, plus the human outcome. `recordSeverityDecision` (`src/lib/severityProposals.ts`) is called **after** Intercom accepts a severity write and stamps the open proposal `accepted` (same number) or `overridden` (different number) with `final_severity`. A write that Intercom refuses leaves the proposal open — nothing is marked decided on hope.

### Surfaces

- `SeverityProposalCard` renders in the `/triage` **and** (19 Aug 2026) `/inbox-v3` detail sheets: the proposal, its confidence and rationale, an **Accept** button (which routes through `esh-write-action`, not a shortcut), and a **Re-score with full thread** button.
- Severity is also editable from `TicketFieldsPanel` on both surfaces. On Inbox v3 the panel passes `expectedCurrent = null` because the v3 row does not carry Severity, so a ticket that already holds one in Intercom comes back as a 409 stale-conflict instead of being overwritten — the operator reloads rather than the Hub guessing. `recordSeverityDecision` fires on both surfaces after Intercom accepts.
- Triage toolbar: "Propose severity for visible (max 25)", reporting `proposed / unchanged / failed / calls left today`.
- `/severity-ai` (editor-visible, admin-editable rubric): agreement rate, a proposed-vs-final matrix, the disagreement list with rationale and direct Intercom links, token cost, and the rubric editor.

### Verification (18 Aug 2026)

- Live proposal on Intercom #215475026117090: Severity 4, high confidence, rubric v1, 685 input / 86 output tokens.
- Dedup proven: an immediate identical re-run returned `calls: 0`, `skipped: "unchanged"`, no model call.
- **UNVERIFIED:** the kill-switch-off refusal, the daily-cap refusal, the unknown-ticket-id branch, and the accept → `recordSeverityDecision` → `accepted`/`overridden` round trip through the UI. None of these has been exercised live.

## Severity classifier training foundation (19 Aug 2026)

### Why

A classifier only improves if disagreement is captured with a reason and measured against ground truth. Before this, an override recorded only that the human chose a different number, and the few-shot block was built from the model's own earlier summaries — a misread could be taught back as fact.

### What changed

1. **Reason on override.** `recordSeverityDecision` now lives inside `TicketFieldsPanel` (the pages no longer call it, so it fires exactly once) and returns the decision. When the human's number differs from the open proposal, the panel prompts for a reason code (`OVERRIDE_REASON_CODES` in `src/lib/severityProposals.ts`) plus an optional note, saved to `severity_proposals.override_reason_code` / `override_reason_note`. The prompt is skippable — the decision is already recorded either way.
2. **Real ticket text.** `propose-severity` stores `input_excerpt` (first 600 chars of the actual thread text it scored) and builds its few-shot block from those excerpts, overridden examples first, each carrying *why* it was corrected. It never quotes its own rationale back at itself.
3. **Showdown (`run-severity-eval`).** Samples N tickets (max 50) that already carry a human Severity in Intercom via `v3_severity_eval_sample(n)` and scores them **cold** — rubric only, no few-shot — into `public.severity_eval_runs` / `severity_eval_items`. These stay OUT of `severity_proposals` so a backfill can never masquerade as live triage. Each disagreement is adjudicated `ai_wrong` / `human_wrong` / `both_defensible`; only `ai_wrong` is treated as training signal, because the severity on an old ticket is not automatically correct.
4. **Backtest (`backtest-severity`).** Re-scores decided proposals and `ai_wrong` showdown items against the rubric text **currently in the editor**, returning exact-match / off-by-1 / off-by-2+. Nothing is saved: a rubric edit gets measured before it is published.
5. **Reason roll-up.** `severity_override_reason_rollup()` powers a table on `/severity-ai`; a reason that keeps recurring is a rubric gap, not a model failure.

All three new surfaces live on `/severity-ai` (`src/components/severity/SeverityTraining.tsx`). Runs and backtests are gated on the `editor` role (`require-editor.ts`), and no path here writes to Intercom.

### Verification (19 Aug 2026)

- `run-severity-eval` `{ n: 3, pass: "triage" }` → `scored: 3`, `failed: 0`, rubric v2. Outcome: 1 agreement (Sev 3 = Sev 3), 2 disagreements (AI 4 / ticket 2, AI 2 / ticket 3) left `pending` for human adjudication.
- `backtest-severity` correctly refused with `400 "No backtestable cases yet — a case needs a stored ticket excerpt and a human severity."` — no decided proposal carries an `input_excerpt` yet, since excerpts only start accruing on proposals made from now on.
- **UNVERIFIED:** the override reason prompt end-to-end through the UI, the backtest path sourced from adjudicated `ai_wrong` showdown items, and the daily-cap refusal on `run-severity-eval`.

## One Update button for ticket fields (19 Aug 2026)

### What changed

The `/triage` and `/inbox-v3` detail sheets no longer show a write button per field. `TicketFieldsPanel` (`src/components/issues/TicketFieldsPanel.tsx`) renders severity (Triage and, from 19 Aug 2026, Inbox v3), owner, product area and ticket type in one panel behind a single **Update in Intercom** button. The button names how many fields are dirty; only those fields are written.

### What did NOT change

The write contract is identical. Each changed field is still its own `esh-write-action` call (`set_severity` / `set_owner` / `set_product_area` / `set_classification`), still Intercom-first with the Hub mirroring the verification GET, still strict `expectedCurrent` conflict checking, still validated against `public.intercom_field_options` for the two list fields, still gated on the `editor` role and the `esh_write_allowed_actions` allowlist.

### Partial writes are visible, not smoothed

Calls run in sequence and a failure on one field does **not** cancel the rest. Every field prints its own line — accepted, refused, or stale-conflict — so a three-field update where one field is refused says exactly which two landed. Only accepted fields update the Hub's local mirror and fire `onWritten`; a refused field keeps its draft value so it can be retried. On Triage, `recordSeverityDecision` fires only after Intercom accepts the severity, so the AI-proposal agreement label still reflects a real write.

### Rollback path

`TicketFieldWriteControls.tsx` and `SeverityWriteControl.tsx` are intentionally left in the repo, unused, as the single-field fallback.

### Verification status

Typecheck clean. **UNVERIFIED live**: no multi-field write, no partial-failure case, and no stale-409 case has been exercised against a real ticket since the panel replaced the per-field buttons.


## Subject override — Hub-only descriptive labels (24 Aug 2026)

Intercom frequently produces useless titles (`Intercom #215474865211089`). The Hub can now carry its own descriptive label for a ticket. This is a **Hub-only display field**: nothing is written to Intercom, and no measurement changes.

### Storage

`intercom_tickets_v3.subject_override` (text, nullable), plus `subject_override_by` (uuid) and `subject_override_at` (timestamptz) for attribution. Intercom's own `subject` column is never touched, so a label can always be reverted to the source value. The v3 sync writer (`_shared/v3-finalize.ts`) writes only `subject`, so re-syncs and finalize cannot clobber an override.

### Display rule (single source)

`src/lib/subjectDisplay.ts` — `displaySubject(row) = subject_override → subject → "Untitled"`. Every v3 surface reads through it: Triage, Inbox v3, Prospects, Dev escalations, SLA workbench (both violation tables and the ticket header), Customer report. Search indexes both the override and the original, so a ticket stays findable by either. Overridden rows render an `edited · Intercom: <original>` subline, so the label never hides what Intercom actually says.

### Editing

- Inline pencil on the Subject cell of every v3 table (editors only), plus a **Clear** action that drops back to Intercom's subject.
- A Subject field in `TicketFieldsPanel` (Triage and Inbox v3 detail sheets), separated from the Intercom-mirrored fields so it is visually clear it does not travel to Intercom.
- Writes go straight to the table under the existing `Editors update intercom_tickets_v3` policy (`can_edit(auth.uid())`); read-only roles get "Update refused — editor role required." Every set and clear appends a `subject_override_set` / `subject_override_cleared` row to `conversation_audit_logs` with old and new values.

### Verification status

Verified live on Intercom #215474865211089: set via SQL and rendered in Inbox v3 with the `edited · Intercom:` subline; then edited **through the UI** to a new label and cleared through the UI, with both actions landing in `conversation_audit_logs` under the acting editor's email and the row falling back to Intercom's subject. Typecheck and build clean. **UNVERIFIED**: the read-only refusal path (an `editor`-less account attempting a save) has not been exercised.

## AI-written subjects for placeholder tickets (9 Sep 2026)

The human override above only helps when someone types a label. Most placeholder titles never get one. A second, lower-priority label layer now fills that gap automatically. Same boundary as the override: **Hub-only display, nothing written to Intercom, no measurement changes.**

### Storage

`intercom_tickets_v3.subject_ai` (text), with `subject_ai_at`, `subject_ai_model` and `subject_ai_source_hash`. Separate from both `subject` (Intercom's, rewritten every sync) and `subject_override` (the human label). Settings: `subject_ai_enabled` (kill switch, default true) and `subject_ai_daily_call_cap` (default 200). Migration `0040_v3_ai_subject.sql`.

### Display rule (extended, still single-source)

`displaySubject(row) = subject_override → subject_ai → subject → "Untitled"`. **A typed human label always beats the AI one.** AI-labelled rows render an `AI · Intercom: <original>` subline, so the source title stays readable. Callers extended to select `subject_ai`: Triage, Inbox v3, Prospects, Owner dashboard v3, Resolution anatomy, CSAT report, Escalations, Monthly lookback, Customer report, `useSlaBatch`.

### The writer

`supabase/functions/generate-ticket-subject`, model `openai/gpt-6-astra` over `/v1/responses` (streamed). Two modes:

- **auto** — selects OPEN tickets only, whose `subject` matches the shared placeholder rule (`^Intercom #\d+$`, blank, `(no subject)`, `no subject`, `untitled`, `-`, `n/a`) and that have neither an override nor an existing AI subject. Closed tickets are never rewritten. Callers: cron secret, service role, or a signed-in editor.
- **manual** — one conversation id, any ticket including one with a perfectly good Intercom title ("Rewrite with AI" in `TicketFieldsPanel`). Editors only.

Input is the Intercom source subject/body plus up to six non-note conversation parts, HTML-stripped and truncated to 4000 characters. Output is one noun-led 4–10 word title, or `Unclear request` when the content is too thin to summarise honestly.

Cost discipline: kill switch, daily cap counted off `subject_ai_at`, max 25 ids per call, and `subject_ai_source_hash` so re-running on unchanged content costs zero model calls. Every write appends `subject_ai_written` to `conversation_audit_logs`.

### Verification status

Verified 9 Sep 2026: #215475214997973 titled "Lovable app backend migration from EU to US"; an immediate re-run reported `modelCalls: 0` (hash skip); kill switch off returned 403; unauthenticated returned 401 and a bad cron secret returned 401; the open-only backfill wrote 19 rows and left the 263 closed placeholders at exactly 263, with `subject_ai` on closed tickets = 0. Typecheck and build clean.

### Trigger (9 Sep 2026)

There is no HTTP cron for this — authoring one is blocked on this project. Instead `sync-v3-open` (already on a 5-minute schedule) ends with a **tail hop**: if that pass inserted or reopened at least one ticket **and** a placeholder query shows an open ticket with neither an AI nor a human label, it invokes `generate-ticket-subject` with `{mode:"auto", limit:10}` using the service-role key. The hop is best-effort — any failure is logged and never fails the sync — and both branches log (`subject-ai hop pending=N [status]` / `skipped — no open placeholders pending`). The placeholder regex in `sync-v3-open` mirrors `PLACEHOLDER_RE` in the writer and `isPlaceholderSubject` in `src/lib/subjectDisplay.ts`; the three must stay in step. Practical effect: new placeholder tickets get a title within minutes of arriving, and titling pauses if the sync pauses.

**UNVERIFIED / NOT DONE**: the tail hop has not yet fired live — it was deployed with 0 open placeholders pending, so it has had no work to do; the next placeholder ticket exercises it and leaves a log line. The read-only refusal path for the AI buttons has not been exercised, and the daily-cap refusal has not been hit.



## PostgREST filter injection guard on contact emails (28 Aug 2026)

The Gmail linker in three edge functions built a PostgREST `.or()` filter by interpolating an Intercom contact email straight into the filter string. PostgREST treats `,` `(` `)` `%` `\` `"` `'` and whitespace as structure, so a crafted address could restructure the filter and match Gmail rows it had no claim to. Low severity (the address has to arrive from Intercom), but it is a real injection surface into a linking decision that changes ticket attribution.

### The guard

`supabase/functions/_shared/safe-email.ts` — `isFilterSafeEmail(email)` requires a conservative `local@domain.tld` shape and rejects any of the reserved characters above. It is a validator, not a sanitizer: nothing is rewritten, so a rejected address can never be silently turned into a different one.

### Where it is applied

`intercom-webhook`, `poll-intercom-inbox`, `backfill-enterprise-inbox`. On rejection the **email linker alone is skipped** — the existing subject-match tier and the `pending_intercom_links` deferred-link path still run, so a legitimate ticket does not lose its Gmail link because of a strict validator.

### Scanner findings closed as already fixed

Re-checked against current code, not assumed: `gmail_callback_xss` (the callback already escapes via `escapeHtml`), `knowledge_xss` (`inlineMd()` escapes before applying inline formatting), `open_self_signup` (no `signUp` call remains in `Login.tsx`).

### Verification status

Guard logic and call-site placement reviewed in code; build clean. **UNVERIFIED**: no live ticket has yet arrived with a reserved-character contact email, so the rejection branch has not been exercised against production data.

## Deep search — Hub-wide free-text search (`/search`)

A read-only search surface over everything the Hub knows, built because identifiers like a Linear key (`SCA-3522`) or a phrase from a message were only findable if the page you happened to be on already filtered on that field.

### Index — `public.esh_search_index`

Columns `kind`, `ref_id` (composite PK), `title`, `body`, `idents`, `meta jsonb`, `url_path`, `source_updated_at`, `indexed_at`, plus a generated `tsvector` (`title`/`idents` weight A, `body` weight B). GIN index on the tsvector; trigram GIN (`pg_trgm`) on `title` and `idents`. Authenticated **read-only**; only the refresh function writes.

Six kinds: `v3_ticket` (subject + subject_override, every `conversation_parts` body and the source body with HTML stripped, custom attributes flattened, tags, CSAT remark), `note` (`conversation_notes`), `escalation` (`dev_escalations` + Linear metadata), `backlog` (`esh_backlog_items`), `customer` (`v3_customer_accounts`, incl. domains/aliases), `severity_proposal` (rationale, evidence, override reason note).

### Refresh — `esh_refresh_search_index(p_kinds text[])`

Security definer, rebuilds per kind (delete + insert) and returns per-kind row counts. HTML is stripped by `esh_strip_html()`. Scheduled **hourly at :07** (`esh_refresh_search_index_hourly`), plus a **Reindex now** button on the page. Cadence is deliberate: the searched population is overwhelmingly older/closed tickets, so up to an hour of staleness is acceptable and cheaper than sub-hourly polling.

### Query — `esh_deep_search(p_q, p_kinds, p_limit)`

Unions two match paths: `websearch_to_tsquery` full-text against the tsvector, and an identifier path (`ILIKE` + `pg_trgm` similarity on `idents`/`title`) so an Intercom ID, Linear key, email, customer key or Slack channel ID matches even when it is not a lexeme. Returns a `ts_headline` snippet (matches marked `<< >>` and highlighted in the UI), `match_mode` (`text` vs `ident`), `meta` and `url_path`; capped at 500.

### UI — `src/pages/DeepSearch.tsx`

Nav: top-level **Deep search**. Query box (deep-linkable via `?q=`), kind filter chips with per-kind hit counts, index size + last-refresh readout, Reindex now. Result rows link back into the existing pages by seeding their search box through `?q=` (`useInitialQ()` in Inbox v3, Dev escalations, Backlog) rather than adding new deep-link routes; v3 hits also carry the Intercom conversation link.

**Verified 31 Aug 2026:** 997 rows indexed (629 v3 tickets, 253 customers, 43 backlog, 42 escalations, 25 notes, 5 severity proposals). `SCA-3522` returns the escalation and Intercom ticket #215475673305527 (matched from the message body). **UNVERIFIED:** the hourly cron firing in production, and phrase-query result quality at scale.

## Resolution anatomy — why long tickets are long (`/resolution-anatomy`)

Built because the average resolution time was climbing ~1 day/month with no way to say why. The distribution showed the cause is a **tail**, not a shift: Jun→Aug 2026 median resolution stayed ~4d while P90 went 11.8d → 17.5d, and tickets over 7 days account for ~75% of all resolution time.

### Engine — `src/lib/resolutionAnatomy.ts`

`computeAnatomy(raw_payload, { closedAtSec })` walks the same Intercom timeline the SLA engine reads (`extractTimeline` + `classifyActor` from `slaMetrics.ts`, reused unmodified) and attributes every gap to whoever owed the next move:

- **our clock** — a customer message waiting on a human admin reply
- **their clock** — our reply waiting on the customer
- **closed** — the ticket was closed; nobody owed a reply until it was reopened
- **silent drift** — the ticket was open and nobody owed a move

Actor mapping: `customer` and `shared_inbox` (B6 relay rule) are customer-side; `human_admin` is our side; `sam_ai` / `operator_bot` / `system` are **neutral** — an automated ack neither discharges our obligation nor puts the ball back with the customer, so a neutral part does not open or close a gap. Notes and state events are not substantive. Also returns `longestGap` (with who owed it), per-side business-hours seconds (Berlin, `DEFAULT_BUSINESS_HOURS`), reply counts, `closedWithoutCustomerConfirm`, and `timeToFirstCloseS`.

**Closed-state attribution (31 Aug 2026).** The walk is now **event-driven over the full timeline**, not just substantive messages: a `close` part flushes the running segment and stops every clock; an explicit reopen part or the next substantive message after a close flushes the closed stretch and restarts the clock for whoever spoke. Before this, the stretch between a close and a much later reopen was charged to whichever side owed a reply at close time — ticket 215474664060068 showed a 4h 45m first close followed by a 32d 19h gap billed to *us* even though the ticket was shut. `OwedBy` gains `"closed"`, `AnatomyResult` gains `closedS`, and the segment list can now carry several segments per message (reply-wait → closed → post-reopen), which the timeline sheet renders as separate labelled gaps.

`anatomyReconciles()` asserts the four buckets (`us + customer + closed + drift`) sum to wall clock; the page counts failures and prints a banner marking those splits UNVERIFIED. Nothing is persisted and no existing SLA/Analytics number changes — the split is derived on read.


### Page — `src/pages/ResolutionAnatomy.tsx`

Nav under Reports. Two-pass load: scalars for the whole finalized window (paged, no `raw_payload`), then `raw_payload` only for tickets over the long-runner threshold, in chunks of 40. Controls: months (1/2/3/6/12), threshold days (default 7), product area, type, owner, customer, reopened. Surfaces: four share cards (us / customer / **closed** / drift) + cohort counts, median split by month (four-series stacked bars — which bucket is growing answers staffing vs customer responsiveness vs hygiene vs reopen re-clocking), **time to first close vs time to last close** (the headline metric is Intercom's time to *last* close, so a reopen re-clocks the whole ticket), top-10 rollups by product area / owner / customer, and a sortable long-runner table where each row opens a gap-by-gap timeline sheet. The sheet lists every segment attached to a message, so a close shows as its own "Closed — nobody owed a reply" gap rather than being folded into someone's debt.

**Verified 31 Aug 2026** (3 months, >7d, 164 tickets, 0 reconciliation failures, pre-closed-bucket): our clock 25% (584d) vs their clock 75% (1760d); median time to first close 9d 22h vs last close 12d 0h; 136 of 164 closed with no customer reply after our last message; 48 reopened at least once. Worst areas by volume: Account Access and Permissions (24), SSO/SCIM/SAML (19).

**Verified 31 Aug 2026 (closed bucket):** 12 unit tests in `src/lib/__tests__/resolutionAnatomy.test.ts` pass, including a case where a 30-day closed stretch is fully attributed to `closedS` and reconciliation still holds. **UNVERIFIED:** the re-rendered population shares with the closed bucket live (the earlier 25/75 split above predates it), and silent drift, which previously read 0% across the cohort — some of what used to look like "nobody owed" or "we owed" now lands in `closed`, and the split should be re-read before it is quoted again.

### Active clock — closed time removed (31 Aug 2026)

Once closed time was bucketed separately, the next question was whether a ticket should still *count* as a long runner because of time nobody owed. The page now exposes an **active clock** = wall clock − `closedS`, purely on read (no schema change, no engine change, Intercom's own `time_to_resolve_s` is untouched and still the headline number everywhere else).

- `activeOf()` in `src/pages/ResolutionAnatomy.tsx` derives the value; a sortable **Active** column shows it with the deduction inline (e.g. `−32d closed`).
- Checkbox **"Measure long runners on the active clock (exclude closed time)"** re-applies the threshold to the active clock, so tickets that only cross 7d because of a dormant closed stretch drop out of the cohort *and* out of every downstream metric on the page.
- Summary card **"Active clock — closed time removed"**: median recorded vs median active, total closed time in the cohort, and the count of tickets that are long runners *solely* because of closed time — the size of the distortion, stated rather than assumed.

The toggle is off by default: the wall clock stays the reported truth unless someone deliberately asks the narrower question. **UNVERIFIED:** the live population numbers under the toggle (build + typecheck clean, but the cohort delta has not been read off production).



## Intercom team names on the Transferred tab (31 Aug 2026)

The Inbox v3 "Team Reassignment" tab rendered the raw `reassigned_team_id` (e.g. `7723970`) — technically true, operationally useless: nobody can say who owns a ticket from an integer.

### `public.intercom_teams` — cached ID → name mirror

Same pattern as `intercom_field_options`: a cache, not a hardcoded map, so a renamed or new Intercom team shows up on its own instead of silently disagreeing. Columns `(team_id, name, active, first_seen_at, last_seen_at)`; teams that vanish from Intercom are marked `active=false`, never deleted, so a team id still sitting on a historical transferred ticket stays explainable. Read-only to the app (RLS: select for authenticated; writes denied), written by the service role only.

### Sync

Folded into the existing daily `sync-intercom-fields` run (05:20 UTC) rather than a new cron: one Intercom-metadata job, one health row. It reads `GET /teams` and upserts each `(id, name)`.

### Read path

`src/hooks/useIntercomTeams.tsx` — one cached query exposing a `teamName(id)` lookup. `src/pages/InboxV3.tsx` Transferred table shows the name with the raw id as a tooltip, and falls back to the raw id when the cache has no row (never a blank cell, never a guess).

**Verified 31 Aug 2026:** sync run live; `7723970` resolves to **Product Experience Specialists** and renders on the Transferred tab. **UNVERIFIED:** the `active=false` retirement path (no team has disappeared yet) and the cache-miss fallback (every id currently present resolves).

## Monthly lookback — narrative month review (`/monthly-lookback`, 1 Sep 2026)

Management asked for commentary on August 2026, not just numbers: trends, theme and type mix, customer insight, spikes, and what shipped. `/monthly-lookback` (`src/pages/MonthlyLookback.tsx`, nav under Reports) is the read-only page that produces that review, and a "Copy as narrative" button serialises every computed figure plus the saved commentary into a markdown report.

### Cohort and population

Cohort = tickets **created** in the selected month (data floor June 1, 2026). Headline volume is every created ticket. The **reporting population** then removes `transferred_out` plus everything the shared `src/lib/slaExclusions.ts` predicate marks as outside Enterprise support (`rsa_override = false`, the `enterprise-fyi` / `enterprise-duplicate` / `enterprise-not-enterprise` tags, `merged_ticket`, the `not_enterprise` / `prospect_personal` / `enterprise_prospect` resolution methods, and test accounts). Quality metrics run on the **closed** subset of that population. Because the exclusion, CSAT and resolution engines are the shared ones, this page cannot drift from Analytics v3.

### Theme mix is closed-only

Product area and ticket type are set at **closure**, so `buildMix` runs over closed tickets in both the current and the prior month, and spike detection uses the same closed denominators. Counting open tickets produced a large fake `— not set —` bucket that only measured work in flight: for August it was 42 tickets (23% of the created population) and vanishes entirely over the closed population. The card states the population and the reason inline so the number is never read as a categorisation failure.

### Commentary

`public.esh_lookback_notes` stores one commentary row per `(month, section)`. Reads open to authenticated; writes gated by `can_edit()`, matching `sla_violation_overrides`.

### Closure-rule leaks check all four Hub-owned attributes

The Hub owns exactly four Intercom custom attributes: **Severity**, **Affected Product Area**, **Ticket type**, **Escalated to Engineering**. Area and type also land on dedicated columns (`product_area`, `classification`); severity and the escalation flag live only in `custom_attributes`. `missingFields(row)` checks all four and the leak table prints which ones are blank per ticket, so a leak is actionable rather than a bare count.

The bot-written `Product Area` / `Type` attributes seen on some conversations belong to a **different taxonomy owned elsewhere** — they are deliberately never read from and never backfilled into the Hub fields, because the vocabularies do not map.

Sam-owned tickets are excluded from the leak list (the AI agent never sees the closure form) and counted separately as `samGapCount`, so the exclusion is visible rather than silent.

### Escalated to Engineering cut

A stat card in "Shipped and process" reports, over closed tickets: Yes count, share of closed, prior-month comparison, and how many closed with the flag unset. It is part of the narrative export.

### Plan scope and Slack summary

A global **All / Enterprise / SSE** selector scopes every derivation on the page and both exports, so an Enterprise review never mixes in Self-Serve Enterprise tickets. "Copy Slack summary" emits an mrkdwn digest — key metrics with MoM arrows, top 3 areas / types / customers, up to 5 recent changelog entries — under the same plan scope and CSAT integrity filters as the page.

### Active clock is the default (1 Sep 2026)

The "Load active clock" button is gone. Quality reads the persisted `intercom_tickets_v3.resolution_active_s` scalar, so **Median resolution (active)** is the headline on every page load, `Elapsed (raw)` sits beside it for reconciliation, and both the Slack summary and the narrative export emit the active figure. The page stays scalar-only — no `raw_payload` fetch.

**Verified 1 Sep 2026** (August, ultrawide viewport): 242 created / 181 population / 146 closed / 35 open / 94% categorised; theme mix renders over 146 closed against 138 in July with no `— not set —` inflation; median resolve 82.8h vs 91.4h, P90 265.9h vs 446.7h, reopens 13% vs 20%, CSAT 4.47 (n=17). Four-field coverage over the 197 finalized August tickets: Severity 193, Affected Product Area 190, Ticket type 190, Escalated to Engineering 186 (154 No / 32 Yes / 11 unset). The closed tickets missing area or type were bulk-closed through an automated path that bypasses the mandatory closure form. **UNVERIFIED:** per-section note saving and the copy-out under a read-only role; the Slack summary and the plan-scope switch have not been re-verified since the four-field leak change.


## Persisted active resolution clock (1 Sep 2026)

**Problem.** Every reporting surface (Analytics v3, Trend report, Monthly lookback, Insights) reported Intercom's raw `time_to_resolve_s` — calendar time from first inbound to last close. A ticket answered in 2h, closed, then reopened 30 days later reported ~30 days. The reopen finding made this concrete: we were billing ourselves for time the ticket was **shut**.

**Decision.** Persist the stop-the-clock value at finalize rather than deriving it on read (the `resolutionAnatomy` prototype needed `raw_payload`, which does not scale to a report page). Raw is **kept**, not dropped — it is the reconciliation value against Intercom's native reports.

**Schema** (`intercom_tickets_v3`): `resolution_active_s`, `resolution_active_bh_s`, `resolution_closed_s`, `sla_clock_start_at`, `active_clock_computed_at`, `active_clock_engine_version`. Written at finalize by `sync-v3-closed` and `sync-v3-open`; 592 historical finalized rows filled by the one-shot `backfill-v3-active-clock` edge function. Intercom's `time_to_resolve_s` is never overwritten.

**Shared engine.** `supabase/functions/_shared/sla-core.ts` holds the ball-in-our-court walk (customer/`shared_inbox` parts open a segment, our public reply or a `close` closes it, dormant closed gaps excluded) so the edge writers and the browser engine in `src/lib/slaMetrics.ts` cannot drift.

**Display contract.** `src/lib/resolutionDisplay.ts` is the single owner of `ACTIVE_LABEL` ("Resolution (active)"), `RAW_LABEL` ("Elapsed (raw)"), their tooltips, `ACTIVE_CLOCK_ENGINE_VERSION`, and `collectActive()`. Rows with no computed value are **excluded and counted as "not computable"**, never coerced to 0.

## Reporting metric standard (`src/lib/reportingMetrics.ts`) — 2026-09-03

**Problem.** Different reports answered "how fast are we?" with different numbers: SLA surfaces computed from `useSlaBatch`, general reports read persisted or raw columns directly, and Owner dashboard v3 still showed Intercom's raw wall clock. Same question, several answers — which erodes trust in every number we publish.

**Decision.** A **layered standard** enforced by a shared library, not one canonical page:
1. **Population** — `inReportingPopulation()` / `reportingPopulation()`: drops `transferred_out`, applies the plan scope, hides Hub test tickets, and applies the shared SLA exclusion rules (`src/lib/slaExclusions.ts`). Volume surfaces may pass `applySlaExclusions: false` but must then label the wider population explicitly.
2. **Responsiveness** — **time to triage** (first non-empty `Severity` attribute set) and **time to first human reply** (first public reply by a `human_admin`; Sam, bots, notes and the `enterprise-support@lovable.dev` shared relay never count). Both anchored at the SLA clock start (first Enterprise-inbox assignment, else creation), with Europe/Berlin business-hour variants. Intercom's `time_to_first_admin_reply_s` is demoted to labelled context ("First reply (any agent)") because it measures from creation and counts Sam.
3. **Resolution** — the persisted four-way clock (active / customer wait / engineering wait / closed). Raw `time_to_resolve_s` is labelled wall-clock context only.

`METRICS` is the registry: each key carries its label, one-sentence description, persisted column, and rank (`primary` headline-eligible vs `secondary` context). `metricValue()` returns `null` — never 0 — for a missing value, and `aggregateMetric()` reports `n` (rows with a value) alongside `missing`, so a metric can never quietly borrow a denominator it did not earn.

**Engine + schema.** `computeResponsiveness()` in `supabase/functions/_shared/sla-core.ts` (`RESPONSIVENESS_ENGINE_VERSION = 1`) scans `conversation_attribute_updated_by_admin` events for the first non-empty Severity value and the conversation parts for the first public human reply. Migration `0032_v3_responsiveness_columns.sql` adds to `intercom_tickets_v3`: `triage_set_at`, `time_to_triage_s`, `time_to_triage_bh_s`, `first_human_reply_at`, `time_to_first_human_reply_s`, `time_to_first_human_reply_bh_s`, `responsiveness_computed_at`, `responsiveness_engine_version`. Written at finalize via `responsivenessFields()` in `_shared/v3-finalize.ts`; historical rows are filled by the re-runnable `backfill-v3-responsiveness` edge function (editor-gated, computed entirely from stored `raw_payload`, reachable from the "Backfill responsiveness" button on the Inbox v3 sync card). Payloads with no usable timeline are stamped with the engine version and left NULL rather than zeroed.

**Surfaces conformed.**
- **Owner dashboard v3** — was the largest outlier: it read raw `time_to_resolve_s`. It now shows `ACTIVE_LABEL` in the table, and the detail pane shows the full four-way split, the raw wall clock (labelled), time to triage and first human reply.
- **Monthly lookback** — the "Median first reply" card (which was Intercom's any-agent number from creation, previously read as if it were our human response time) is replaced by two headline cards, **median time to triage** and **median first human reply**, each showing its own `n` and its missing count. The any-agent number remains as a third card marked "context only". The narrative export and the Slack summary carry the same three numbers with the same caveats.
- Analytics v3, Trend report, Resolution anatomy and Escalations already read the persisted four-way clocks from `src/lib/resolutionDisplay.ts` and are unchanged by this pass.

**Backfill run + verified (3–4 Sep 2026).** The backfill processed 611 finalized rows, wrote 611, failed 0, remaining 0; all 611 carry `responsiveness_engine_version = 1` (no version skew). SQL reconciliation for **August 2026** (created_at in Aug): 243 rows created → 232 after `transferred_out` + test-ticket exclusion → **179 SLA reporting population** (after `rsa_override = false`, `RSA_FALSE_TAGS`, merged tickets and excluded resolution methods). 156 of the 179 carry a responsiveness stamp; the 23 unstamped are non-finalized (14) or finalized outside the backfill window (9). Aug medians on that population: **triage 3m35s** (n=155), **first human reply 11m58s** (n=153), any-agent reply 17m19s (n=153); P90 triage 4h58m, human reply 8h23m. **Old vs new:** the retired card read any-agent reply over the broader 232-row volume population = 14m17s, against the new headline 11m58s — the gap is definition + population, not a regression. **Negative cases exercised:** 281 stamped rows never triaged (NULL, never 0); 90 with no human reply, of which 65 had no admin reply at all and 25 were agent-only. Conversation `215475758268164` was spot-checked against its raw timeline — Sam posted the only public comment while Matt set attributes and closed without replying, so NULL is correct. **Still UNVERIFIED:** nothing has re-run through `computeResponsiveness()` at finalize since the backfill, so the live finalize path is proven only by the backfill's shared code path.

**Surfaces.**
- **Analytics v3** — active median/average are the KPI headlines; raw median/average and the not-computable count sit in the sub-line.
- **Trend report** — active series only. Raw is never plotted (a raw trend line moves with reopen behaviour, not with our speed) but appears in the tooltip alongside not-computable and zero-active counts.
- **Monthly lookback** — active by default, raw in the Quality sub-line and drill-downs.
- **Resolution anatomy** — unchanged; remains the derive-on-read explainer behind the number.

**Verified 1 Sep 2026 against SQL.** Analytics v3 September: n=21, median active 3h 13m (SQL 3.21h), raw median 3d 19h (SQL 91.4h), 1 at zero active — exact match. Trend report: Jun 2h 27m / Jul 1h 25m against SQL 2.45h / 1.42h. Monthly lookback August: median active 2h 19m against 2h 18m over a hand-rebuilt exclusion predicate (150 closed in SQL vs 154 on the page). Population-wide since June 1 2026 the median moved from **96.67h raw to 2.25h active**.

**Zero-active rows are real, not a bug.** 19 finalized tickets have 0 active seconds: we replied instantly (or an internal teammate commented as a user) and the customer never returned, so the in-our-court clock never resumed. They are counted in the population and surfaced as a "n at 0h active" note, never hidden.

**UNVERIFIED:** the SQL replication of `src/lib/slaExclusions.ts` used for the Monthly lookback cross-check is approximate (4-ticket delta); 2 finalized rows remain not computable and are excluded from every median.

## Customer-wait clock — three-way split (engine v2, 1 Sep 2026)

**Problem.** The active clock deducted two things — closed time and waiting-on-customer time — but only closed time was persisted. Customer wait existed solely as the residual `raw − active − closed`, and that residual is untrustworthy: raw comes from Intercom's `time_to_last_close` while active and closed are walked from the timeline, so clock-start differences, rounding, and payload gaps all landed in the same bucket. "The customer was slow" and "we sat on it" were not distinguishable from stored data.

**Schema** (`intercom_tickets_v3`, all nullable, additive): `resolution_customer_wait_s`, `resolution_customer_wait_bh_s`, `resolution_window_s`. The window column is `close_at − sla_clock_start` — the engine's own denominator.

**Identity.** `resolution_active_s + resolution_closed_s + resolution_customer_wait_s = resolution_window_s`, by construction: all four come from one timeline walk in `_shared/sla-core.ts`. Any drift is an engine bug, not a source mismatch, and is assertable in SQL. Raw stays deliberately **outside** the identity as the Intercom reconciliation value.

**Engine.** `computeCustomerWait(timeline, slaClockStartS, closeAtS, clip)` is the exact mirror of `computeResolutionActive`: it accumulates the stretches where the ball is **not** with us **and** the ticket is **not** closed. Same actor rules (`customer` and `shared_inbox` return the ball; our public reply hands it away; a `close` stops both open clocks). Any non-close part ends dormancy, matching `computeClosedDormant`, so no second is stranded between the three buckets. `ACTIVE_CLOCK_ENGINE_VERSION` is bumped 1 → 2; `activeClockFields` (finalize) and `backfill-v3-active-clock` write the new columns.

**Verified 1 Sep 2026** after a forced re-backfill of all 592 finalized rows: identity violations **0**; nulls unchanged at **2** (the same not-computable rows); `resolution_active_s`, `_bh_s` and `_closed_s` byte-identical to their pre-backfill snapshot on all 592 rows (**0 changed**) — the refactor did not move the existing metric. Population medians: **active 2.25h vs customer wait 49.97h**; totals **2,417.7 ticket-days of customer wait vs 86.8 ticket-days of closed time**, confirming the residual was dominated by customer wait and never a safe proxy.

**Display pass — done 2 Sep 2026** (see "Four-way clock display pass" below). Business-hours customer wait is stored for symmetry but is arguable (a 02:00 Berlin customer reply contributes zero); every surface reports on the raw-seconds column.

## Engineering-wait clock — four-way split (engine v3, 1 Sep 2026)

**Problem.** After the three-way split, every second where the ball was not with us landed in `resolution_customer_wait_s`. But a ticket escalated to engineering looks identical: we tell the customer "escalated to our internal teams", the ball leaves support, and the wait is recorded as the customer being slow when it is in fact ours. That inflates customer wait and hides engineering latency.

**Schema** (`intercom_tickets_v3`, all nullable, additive, migration `0026`): `resolution_eng_wait_s`, `resolution_eng_wait_bh_s`, `eng_wait_start_at`, `eng_wait_end_at`, `eng_wait_source`. `dev_escalations` gains `linear_created_at`, `linear_started_at`, `linear_completed_at`, `linear_canceled_at`, `linear_state_type`, mirrored read-only by `sync-linear-escalations` (GraphQL query extended with those timestamps).

**Identity.** `resolution_active_s + resolution_closed_s + resolution_customer_wait_s + resolution_eng_wait_s = resolution_window_s`. Engineering wait is **carved out of customer wait only** — `customerWaitSegments()` now returns the stretches, and `computeEngineeringWait()` intersects them with the escalation window. Active and closed time are never reclassified, by construction.

**Window.** Opens at the earliest `conversation_attribute_updated_by_admin` part whose attribute is `Escalated Issue` / `Linear Issue` **and** whose value is a real Linear reference (`isLinearReferenceValue` — the same field also holds Slack links and free text, which must not open a window); falls back to the `dev_escalations` row date, then `linear_created_at`. Closes at `min(linear_completed_at, linear_canceled_at)` else the ticket close. Clamped into the resolution window; a reference attached after close, or a fix completed before the reference was recorded, yields **0** rather than a fabricated span. `eng_wait_source` records which signal opened it.

**Verified 1 Sep 2026** on a forced re-backfill of all 592 finalized rows (engine version 1→3): identity violations **0**; `resolution_active_s` and `resolution_closed_s` byte-identical to their pre-backfill snapshot on all 592 rows (**0 changed**); **30 tickets** carry engineering wait totalling **3,542.3h**, moved out of customer wait (58,023.8h → 54,481.4h, exactly the 3,542.3h delta). All 30 resolved via `attribute_event`; no row used the `dev_escalation_row` or `linear_created` fallback, so **those two branches are UNVERIFIED on live data**. Negative case checked: of 34 finalized tickets with a Linear reference, the **4** at zero are each explained — three had the attribute set after the ticket closed (1h22m, 9 days, and a month later) and one (ENT-2804) had the Linear issue completed three days before the reference was recorded.

**Display pass — done 2 Sep 2026** (see "Four-way clock display pass" below). Analytics v3, the Trend report, Resolution anatomy and `/escalations` all read the persisted four-way columns.

## Multi-Linear escalations — one ticket, many issues (option B, 2 Sep 2026)

**Problem.** `dev_escalations` was unique per conversation, so a ticket escalated twice could only carry one Linear key. The second issue's window was still counted as *customer wait*, understating engineering latency. Observed on `215475479744265` (ENT-3478 in the attribute, ENT-3798 only in a note).

**Source of truth stays the Intercom attribute.** `Escalated Issue` is free text (confirmed against `intercom_field_options` — not a restricted list), so **no new Intercom field is needed**: several issues are written comma / newline separated. `extractKeys()` in `sync-linear-escalations` pulls **every** `linear.app/.../issue/KEY-123` reference; when none match it falls back to splitting on `,`/newline/`;` and running the single-key parser per part. Single-issue tickets behave exactly as before.

**Schema** (migration `0028_dev_escalation_links`): new `public.dev_escalation_links`, unique on `(intercom_conversation_id, linear_key)`, holding the read-only Linear mirror (title, state, state type, assignee, url, created/started/completed/canceled, synced_at). `dev_escalations` is **unchanged** and remains the Hub-owned decision row (hub_state, owner, follow-ups) for the **first** key only — the board's primary.

**Engine.** `resolveEngWaitWindow` → `resolveEngWaitWindows`: one window per linked issue (start = max of the attribute-edit timestamp and that issue's own `linear_created_at`; end = min of its completion/cancellation and the ticket close), then **unioned** so overlapping escalations never double-count and gaps between them fall back to customer wait. `loadEngEscalations` reads both tables and returns `EngEscalation[]` per conversation. The four-way identity is untouched.

**Notes stay advisory.** A Linear key that appears only in a conversation note is **not** clock-bearing — a casually pasted link must not move reported time. Adding it to the attribute is the deliberate act that makes it count.

**Verified 2 Sep 2026.** `sync-linear-escalations`: 49 candidates → 45 distinct keys → **44 link rows** written, 43 primary rows, 5 keys not found in Linear (pre-existing, unrelated teams). Forced re-backfill of all finalized rows: **596 at engine version 3**, identity violations **0**, engineering wait unchanged at **3,542.3h across 30 tickets**. `215475479744265` now carries both links (ENT-3478 Done, ENT-3798 In Review) and its eng wait stays **408,352s** — correctly, because ENT-3798 was created 1 Sep, *after* the 31 Aug close, so its window clamps to zero. The union path therefore has **no live row yet where two windows both contribute** — that branch is **UNVERIFIED on live data**.

**UI.** `/escalations` shows a `+N` badge next to the primary key and lists every linked issue (key, state, title) in the row detail, labelled as the union that feeds engineering wait.

## Security batch A — definer-function lockdown + SSRF gate (2 Sep 2026)

Applied so the project can be published. Two scanner findings closed; the larger batches were deliberately left open.

### Definer-function lockdown (migration 0027)
- Every `SECURITY DEFINER` function in `public` (27, extension-owned `pg_trgm` functions excluded) had `EXECUTE` revoked from `PUBLIC` and `anon`, then granted explicitly to `authenticated` and `service_role`.
- Why it mattered: the publishable anon key is public by design, and a definer function runs as its owner — so an unauthenticated caller could invoke reporting RPCs such as `v3_coverage_current` or `esh_deep_search` and read data straight past RLS.
- `public.esh_strip_html(text)` had `search_path = public` pinned; it was the last mutable-search_path function we own.

### SSRF gate on `sync-knowledge-pending`
- The function fetched a caller-supplied `sourceUrl` with no auth check — usable to probe internal/metadata endpoints and to stage fabricated pending knowledge content for admin approval.
- Now requires the service-role key (maintenance callers) or a signed-in editor session via `requireEditor`.
- `sourceUrl` must be `https` on an explicit host allowlist (`enterprise-support-hub.lovable.app`, the project preview host). Anything else returns 400 before any fetch.

### Verification status
- Negative (run): anon-key POST to `/rest/v1/rpc/v3_coverage_current` → 401 `permission denied for function`; `sync-knowledge-pending` → 401 with no Authorization header, and 401 with the anon key alone (a `169.254.169.254` sourceUrl never reached the fetch).
- Positive (run): `has_function_privilege` confirms `authenticated` and `service_role` retained `EXECUTE`; build clean.
- UNVERIFIED: the editor-session-with-disallowed-host 400 branch (no editor session was minted in this pass).

### Deliberately still open
- Batch B — the ~32 cron/webhook-invoked mutation and sync functions. They authenticate with the anon key, so a naive `requireUser` would silently 401 every scheduled job; they need a two-path guard (user JWT or cron secret) plus rewritten cron commands.
- Gmail OAuth `state` binding on `gmail-auth-url` / `gmail-oauth-callback`.
- Slack attachments still land in the public `public-assets` bucket; a private bucket plus signed URLs would break already-stored permanent URLs and needs its own pass.
- Known display consequence of the existing deny-all policy on `gmail_oauth_tokens`: `src/pages/Index.tsx` reads that table from the client, so the Gmail connection indicator can read "not connected" even when it is. Folded into the Gmail pass.

## Four-way clock display pass (2 Sep 2026)

Closes the display gap left open by the three-way (30 Aug) and engineering-wait (1 Sep) engine passes. **Presentation only** — no engine, migration or edge-function change; every number is read from the persisted columns.

**The rule the pass enforces.** `resolution_active_s` stays the ONLY headline. The four-way split answers "where did the elapsed time go", which is a different question from "how long did we take", so it renders as a sub-line, a tooltip or a drill-down — never a KPI of its own, and never a chart series plotted beside the headline. A month plotted on raw seconds next to a month plotted on active seconds invents a trend that does not exist.

**Shared helpers** (`src/lib/resolutionDisplay.ts`, extending the existing active/raw module so no surface can define its own bucket order or colour):
- `SPLIT_KEYS` = `active` · `customerWait` · `engWait` · `closed`, with `SPLIT_LABEL`, `SPLIT_TOOLTIP` and `SPLIT_CLASS` (engineering wait uses brand pink `#E66FD2`).
- `rowSplit(row)` — the split for one row, or **null** when the engine never stamped `resolution_window_s` or any bucket is missing. A partial row is **excluded**, never zero-filled into `active`.
- `summarizeSplit(rows)` — **sum-then-share**, never mean-of-shares. Returns `totals`, `n` (rows that contributed), `noSplit` (finalized rows the engine never stamped — surfaced in the UI as "N without split", not silently dropped) and `share` per bucket.
- `splitMedians(rows)` — per-bucket medians over rows carrying a full split.
- `SPLIT_FOOTNOTE` — one shared explanation, so the four surfaces cannot drift apart in wording.

**Shared component** `src/components/ResolutionSplitLine.tsx`: stacked bar plus a share legend, with an explicit "split unavailable" state when no row in range carries the engine-v3 columns.

**Surfaces.**
- **Analytics v3** — a "Where the time went" sub-line under the resolution KPIs, over the same in-range finalized population the headline uses. Query extended with the four persisted columns.
- **Trend report** — the default Recharts tooltip is replaced by `ResolveTooltip`: average and median active clock (the plotted series), the raw median and not-computable count for reconciliation, then the four-way split for that month. `MonthBucket` gains `split`. Still only two lines are ever drawn.
- **Resolution anatomy** — a new **whole-cohort** card on the persisted columns, with per-bucket medians, above the existing long-runner panel. The legacy client-side Our clock / Their clock / Silent drift / Closed anatomy was **deliberately kept, not replaced**: the taxonomies are not interchangeable (engine v3 has an explicit engineering-wait bucket and no "silent drift"), and the client-side one only ever covered tickets over the threshold because it parses `raw_payload` per ticket. The persisted card covers the whole in-scope cohort.
- **`/escalations`** — an "Eng wait" column reading `resolution_eng_wait_s`, showing "union of N issues" when several Linear issues are linked (the union is computed in the engine, so two escalations never double-count). Rows below `active_clock_engine_version >= 3`, and any non-finalized row, render an em dash rather than a fabricated 0. Since 4 Sep 2026 the column also carries the WINDOW the seconds were measured over — `eng_wait_start_at → eng_wait_end_at` as `d MMM` under the duration, full timestamps plus `eng_wait_source` in the hover title, and the same window as its own "Engineering wait" field in the row detail sheet. The window renders only when the engine stamped a start; a missing start reads "Window not recorded" and a missing end reads "still open at close" — neither is inferred from the ticket dates. Presentation only: no engine, migration or edge-function change.

**Envelope vs per-issue windows, and the note-only detector (4 Sep 2026, presentation only — no schema, no engine, no clock change).** The persisted span is now labelled **`Envelope:`** in the row detail, because on a multi-issue ticket it is the outer first-start → last-end and is therefore WIDER than `resolution_eng_wait_s`. The seconds were never coarse: the engine already unions each issue's window and intersects it with customer-wait time, so the number is the accurate one and only the two timestamps were an envelope. The detail sheet now also lists every mirrored `dev_escalation_links` issue with its own Linear lifespan — `linear_created_at → linear_completed_at` / `linear_canceled_at (canceled)` / "still open", plus `linear_state` — so the reader can see the parts behind the total. Per-issue **seconds** are deliberately NOT shown: overlapping windows cannot be attributed to one issue without double-counting, and the UI must not re-derive a second, divergent number.

**Detector.** The board extracts Linear-shaped keys (`[A-Z][A-Z0-9]{1,5}-\d{1,6}`, narrow on purpose so `COVID-19`-style noise does not match) from the `intercom_v3` conversation notes it already loads, and subtracts the clock-bearing set: every `dev_escalation_links` key plus whatever the `Escalated Issue` / `Linear Issue` attribute and the Hub override resolve to. Anything left over renders as an amber **"Note-only Linear keys"** field in the row detail and as a board banner with a **"Show only these"** filter. It is stated as advisory: a key mentioned in a note NEVER moves a clock until a human copies it into the attribute or the Hub override. The attribute remains the single clock-bearing source.

**Verified 4 Sep 2026** at 2560px on `215475479744265`: eng wait **6d 19h**, envelope 14 Aug 18:53 → 3 Sep 17:09 (`attribute_event`), per-issue rows ENT-3478 (14 Aug → 19 Aug, Done) and ENT-3798 (1 Sep → still open, In Review). Detector verified with a temporary note carrying `ENT-9999` on the same ticket — banner read "1 escalation mentions…" and the detail field listed ENT-9999 — and the note was deleted afterwards. **UNVERIFIED:** the live note-only population is **0** rows (no `intercom_v3` note contains a Linear key today), so the detector has never fired on real data.


**Verified 2 Sep 2026.** Typecheck and build clean. Against the live table across all finalized rows: **599** carry a full split, **2** do not (reported as "without split"), **0 identity violations** (`active + customer + eng + closed = window` within 2s). Population shares: active **23.0%** · customer wait **69.9%** · engineering wait **4.4%** · closed **2.7%**.

**UNVERIFIED.** The four pages were not loaded in a browser at ultrawide width in this pass — verification was typecheck, build and the SQL reconciliation above only.


## Incident feed from Slack #incidents (3 Sep 2026)

Surfaces Lovable's incident.io incidents inside the Hub: a live "what's broken now" banner and a searchable historical log. **Slack-only by design** — the incident.io API is explicitly NOT used. A workspace incident.io connector exists but belongs to two other owners, and Matt will not use it without their explicit permission, so it stays backlog.

**Storage.** Migration `0033_create_incidents_from_slack.sql` creates standalone `public.incidents` (unique `incident_number`, title, severity, status, `status_category`, `is_customer_impacting`, incident/status-page/Slack links, `declared_at`/`resolved_at`, provenance `slack_message_ts`). Authenticated read, service-role write. It touches **no v3 table and no existing trigger** — incidents are a separate dimension, not a ticket attribute.

**Ingestion.** `poll-slack-incidents` (`verify_jwt = false`, gated by `requireEditorOrSecret`) reads the channel through the Slack connector gateway and upserts by `incident_number`. incident.io **edits its announcement in place** rather than posting updates, so a rolling window + upsert is the correct shape: re-reading a window costs nothing and always converges on the current card. `resolved_at` keeps the first observed value. Modes: `{lookbackDays}` (rolling), `{full: true}` (whole channel), `{dryRun: true}`.

**Three announcement formats had to be parsed** — this is the part that is easy to get wrong:
1. **Current** — header carries the title, a `*Status*:` section carries the lifecycle, `[Severity]` prefixes the raw text.
2. **Terminal/older** — the whole card is replaced: the header becomes `Incident declined` / `closed` / `resolved` / `merged` and the *real title moves to the quoted line* of the section. Without handling this, 280 rows were titled "Incident declined" with a null status. Some cards also append severity to status (`Documenting (Minor)`), which is split into status + severity fallback.
3. **Pre-Oct 2025** — no `*Status*:` line at all; the only lifecycle signal is the header emoji. **Only** `:white_check_mark:` is mapped (→ Closed), because incident.io uses it unambiguously for a finished incident. Every other emoji is left `unknown` rather than guessed into a live/closed bucket — a wrong live incident is worse than an honest gap.

**Customer impact** is derived from the presence of a `statuspage.incident.io` public status-page link in the announcement. The API's status-page endpoints return 404, so this is the only available signal and it is a *derived* flag, labelled as such in the UI.

**Surfaces.** `IncidentBanner` (rendered in `AppLayout`, above page content) polls live incidents every 60 s, links to the incident/status page/Slack channel, expands when several are live, and is dismissible for the session only — a changed live set reopens it. On a read failure it **stays silent rather than showing a false all-clear**. `/incidents` is the historical log: search, severity/category/customer-impact filters, sortable headers (shared `useTableSort`), CSV export. **Default status filter = `live` (4 Sep 2026)** — the page opens on "what's broken now"; "All statuses" is one click away for the historical log. The default only changes the initial filter state, not the underlying query or data.

**Health.** `integration_health.slack_incidents_poll` registered in all three lists (`_shared/integration-health.ts`, `IntegrationHealthCard.tsx`, `integration-health-alert`), 30-min staleness threshold.

**Verified 3 Sep 2026.** Full rescan: 2,026 Slack messages scanned, 1,049 announcements parsed, 964 skipped as non-announcements, 1,049 rows upserted, 0 errors, no unknown status formats. Resulting population: **1,008 closed · 10 live · 6 post-incident · 25 unknown**. The 25 unknown are all Jan–Feb 2025 (the earliest incident.io card format, no status signal at all) and are left honestly unknown. Typecheck clean.

**Cron scheduled 4 Sep 2026.** Job `poll_slack_incidents_15min`, schedule `*/15 * * * *` (96 runs/day), `net.http_post` to `poll-slack-incidents` with `public.esh_cron_headers()` (cron secret from `public.cron_auth`, never inlined in the job), body `{"mode":"rolling"}`, 60 s timeout. **Cadence chosen deliberately over 5 min**: a frequent job keeps the database awake even when nothing happened, and 15 min of banner staleness is well inside how fast anyone acts on an incident — worst-case lag is 15 min. Authored **by hand in the SQL editor by Matt**: agent SQL and the migration tool both refuse HTTP cron authoring on this project, and the managed HTTP-schedule tools are not exposed here, so this job exists in the database only — it is **not** represented by a migration file in `supabase/migrations`.

**Verified 4 Sep 2026 (first fire).** 21:45:06 UTC: `integration_health.slack_incidents_poll` → `last_status = ok`, `last_success_at = 21:45:06`, `consecutive_failures = 0`; 7 incident rows re-stamped in that run and the population moved 1,049 → 1,050 (one new incident ingested by the cron, not by a manual call).

**UNVERIFIED.** The schedule row itself was never read back: `cron.job` and `cron.job_run_details` are permission-denied for both the agent SQL role and the psql role, so recurrence is inferred from the on-the-minute success at `:45` plus the job id returned in the SQL editor, not directly observed across two fires. The banner and `/incidents` page were still not loaded in a browser at ultrawide width.

### Stuck-live fix — targeted re-check (9 Sep 2026)

**The bug.** Slack's `oldest` filter matches a message's **original post time**, not its last edit. Because incident.io edits one announcement in place for the whole lifecycle, any incident declared before the rolling window (default 2 days) and resolved inside it was never re-read — its row sat `live` forever. Observed: INC-1899/1901/1904/1913 marked live with `last_synced_at` 3–5 days stale, and the banner claiming 15 live incidents.

**The fix (option C — targeted re-check, chosen over widening the window or a nightly full rescan).** Step 2b of `poll-slack-incidents` now, on every non-`full` run, selects rows still in `live`/`unknown` (newest 60, `RECHECK_CAP`) and re-fetches **each one's own Slack message by its stored `slack_message_ts`**, then merges the parse into the same upsert path. Cost is one small Slack call per stuck row, unrelated to how far back the incident was declared. Two implementation details that were failure modes, both hit in testing:
- Slack can return **zero messages when `oldest === latest`** even with `inclusive=true`; the bracket is `ts ± 1s` with an exact-`ts` match picked out of the result.
- **Terminal cards carry the incident link only as an inline mrkdwn `<url|label>`** inside the section text — there is no button block with a `url` field. The parser previously harvested only `node.url`, so every merged/declined card was silently dropped as "not an announcement", which is exactly what kept INC-1913 (merged) live. Inline URLs are now harvested too.

Run summaries report `recheck_fetched`, `recheck_changed`, `recheck_missing`; an unfetchable or unparseable re-check logs a warning and is named in the summary rather than being swallowed.

**Verified 9 Sep 2026.** Rolling run after the fix: `recheck_fetched: 37, recheck_changed: 1, recheck_missing: []`. INC-1913 moved `Investigating`/live → `Merged`/closed with `resolved_at 2026-09-06 13:02:04Z`. Live population **15 → 13**. Negative case exercised for real: before the inline-URL fix the same run logged `recheck INC-1913: unparseable announcement` and left the row untouched — the failure was visible, not silent. Full rescan re-run with the new parser: 2,038 scanned, 1,228 parsed (was 1,049), 797 skipped, **171 previously-unparseable terminal cards recovered**, 0 errors. Population now **1,182 closed · 13 live · 8 post-incident · 25 unknown**.

**UNVERIFIED.** No cron fire has been observed since the change (next `*/15` run); the re-check path has only been exercised by manual invocation.


### Outbound-initiated conversations and the timeline close fallback (9 Sep 2026)

**Problem.** Two finalized rows (`215474972075677`, `215475476004105`) carried no resolution metrics at all. Root cause was not the tickets: Intercom returned an **empty `statistics` block** on both, and `resolveCloseAt()` read close time only from `statistics.last_close_at` / `first_close_at`. No close time → every clock null → the rows were reported as "not computable" forever. Both payloads did contain a real `close` part in the timeline.

**Fix 1 — timeline close fallback.** `resolveCloseAt(stats, timeline?)` still treats statistics as authoritative; only when both statistical fields are absent does it take the **last `close` part** on the timeline. No fabricated timestamp is ever used.

**Fix 2 — outbound-initiated ball ownership.** `isOutboundInitiated(conversation)` is true when `source.author.type` is `admin` or `bot`, i.e. **we** opened the conversation. For those, the opening message is ours, so the ball starts on the **customer's** side: `computeResolutionActive()` and `customerWaitSegments()` take `initialBallWithUs` and start the waiting-on-customer stretch at the clock start. Previously an outbound email with no reply billed the entire silence to us as active time — measuring our own outreach as support work. Inbound conversations are unaffected (the default stays `true`).

**Schema.** Migration `0036_v3_outbound_initiated_flags.sql` adds `intercom_tickets_v3.outbound_initiated` and `.customer_replied` (customer authored anything after the opening message). `outbound_initiated AND NOT customer_replied` is the **outbound-only / no customer response** case. Both are stamped at finalize by `activeClockFields()` and by `backfill-v3-active-clock`.

**Verified 9 Sep 2026.** `ACTIVE_CLOCK_ENGINE_VERSION` bumped 3 → 4 and all **656** finalized/reopened rows re-backfilled (500 + 156, `failed 0`, `skipped_no_parts 0`, `remaining 0`). Post-state: **uncomputable 0** (was 2), **identity violations 0**, `outbound_initiated` **3**, outbound-only **2**.
- `215474972075677` "Connect GitHub repository" — outbound, never answered: window 475,203s, **active 0**, customer wait 475,203s, closed 0. This is the correct read: we emailed and waited.
- `215475476004105` — outbound, never answered: window 604,305s, all customer wait.
- `215475789771012` "[Lovable support] - investigation for mybellwether project" — outbound but the customer **did** reply: active 297,679s / customer wait 137,929s.

**UNVERIFIED / open.** The pre-backfill values of the third outbound row were not snapshotted, so its active-second delta from the ownership change is not quantified. `215475476004105` is an internal allowlist request, not a support problem; Matt proposed classifying it **Enterprise FYI** and excluding it from issue-based SLA/resolution reporting — **not applied**, awaiting his call.


## Ask Pax to investigate — Slack request + Intercom internal note (9 Sep 2026)

**Why.** Almost every enterprise ticket goes through the same manual investigatory step: paste the Intercom conversation into `#pax-ets-help`, ask the Pax bot to look, then copy the Slack thread into an Intercom note so a takeover sees the investigation. This automates exactly that, and nothing more.

**Scope of the write.** A deliberate, narrow exception to the v3 read-only posture. Two writes per ticket, ever:
1. one Slack message in the Pax help channel naming the Intercom conversation, and
2. **one Intercom internal note** carrying the Slack thread permalink.

It never writes a customer-facing reply and never touches an Intercom-owned column of `intercom_tickets_v3`.

**Function.** `supabase/functions/ask-pax-investigate` — `requireEditor`, then the same global kill switch (`settings.esh_write_enabled`) that gates every other Hub write. Every attempt (succeeded / blocked / failed) writes an `esh_ticket_actions` row under action `ask_pax_investigate` or `pax_retry_note`. The note is authored as the acting teammate's `intercom_admin_id` from `public.teammates`, never a bot admin, so `classifyActor` still reads it as `human_admin`.

**Schema.** Migration `0038_pax_investigations.sql` creates `public.pax_investigations` with `intercom_conversation_id` as **PRIMARY KEY** — that is the idempotency guard, not application logic. Columns: Slack channel/ts/permalink, `note_state` (`pending` | `linked` | `failed`), `note_error`, `note_linked_at`, requester (uuid, name, email). Authenticated read, service_role write. `settings` gains `pax_help_channel_id` and `pax_request_template`.

**Partial failure is visible, never silently repaired.** If the Slack post succeeds and the Intercom note fails, the row is left at `note_state='failed'` with the provider error and the caller gets a 502 `{noteFailed:true}`. The UI shows **"Link to Intercom failed"** with an explicit **Retry link** action (`mode=retry_note`) that re-attempts **only** the note. A repeat click on the main button posts nothing — it returns the existing thread.

**UI.** `src/components/issues/PaxInvestigateControl.tsx`, mounted in the `/inbox-v3` and `/triage` detail sheets. Read-only accounts see the state but no actions.

**Configuration.** Channel resolves from `PAX_HELP_CHANNEL_ID` → `settings.pax_help_channel_id` → lookup by name `#pax-ets-help` via `conversations.list` (requires the bot to be in the channel). Prompt text from `settings.pax_request_template` with `{url}`, `{id}`, `{subject}`, `{pax}` placeholders.

**Pax must be mentioned for real.** Plain-text `@Pax` is inert — Slack only notifies the bot when the message carries a true `<@Uxxxx>` mention, so early runs posted messages Pax never saw. The function now resolves Pax's member id from `PAX_SLACK_USER_ID` → `settings.pax_slack_user_id` → a one-pass `users.list` scan matching name/real_name/display_name = "pax" (the resolved id is written back to settings), renders `{pax}` — and rewrites any literal `@Pax` left in a stored template — as `<@id>`, and posts with `link_names: true`. If no Pax user can be resolved the request is **blocked (409)** rather than posting an inert message. Live value: `settings.pax_slack_user_id = U0ATD9291L3` (migration `0039_pax_slack_user_id.sql`).

**Verified.** Slack post, permalink capture, Intercom internal note, idempotent repeat click, and the 401 / invalid-mode 400 / missing-row 409 negative cases were all exercised on conversation `215475870430467`. **UNVERIFIED:** the kill-switch-off refusal, the forced note-failure Retry path, and the new real-mention post actually waking Pax (the mention change was deployed and the id stored, but no post-fix run has been observed).

**Posts as the human, not a bot (10 Sep 2026).** Pax refused the shared Ask Lovable bot identity ("I couldn't verify you as a lovable.dev user") and its owner confirmed Pax answers humans differently from bots. The feature was unpaused and rebuilt to post as the teammate who clicks it:

- **Per-person Slack authorisation.** An internal Slack app (Enterprise Support Hub, `A0C0ZHB0AAD`) is registered as a Slack App User Connector client with user token scopes `chat:write`, `channels:read`, `users:read`, no bot scopes, no public distribution, redirect `https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback`.
- **Flow.** `slack-user-connect` (start, popup) -> Slack consent -> `/oauth/slack/return` forwards ONLY the one-time code -> `slack-user-connect-complete` exchanges it, runs `auth.test`, and stores the `lovack_*` key **AES-GCM encrypted** in `public.app_user_connections` (migration `0042_app_user_connections.sql`; service-role grants only, restrictive deny-all policy for anon/authenticated). `slack-user-connection` returns status and performs disconnect (gateway revoke + row delete). No connection key, Slack token, or ciphertext ever reaches the browser.
- **Ask Pax now runs as that user.** `ask-pax-investigate` no longer uses `SLACK_BOT_TOKEN`; `chat.postMessage`, `chat.getPermalink`, `conversations.list` and `users.list` all go through `callAsAppUser` with the caller's key. **No shared-bot fallback:** without a personal connection the request is refused `409 { slackConnectRequired: true }`. A gateway `401 credential_*` becomes an explicit "your Slack authorisation needs renewing" instead of a generic failure.
- **Roster gate.** Connecting and asking are limited to active `teammates` rows with `role = 'support'` (Enterprise Support). Intercom note attribution, idempotency, the kill switch and `esh_ticket_actions` audit logging are unchanged.
- **Verified live (10 Sep 2026)** on conversation `215475881886059`: OAuth consent completed and the UI reported "Your Slack account is connected"; the `#pax-ets-help` post (`C0BD2BQA63G`, permalink `.../p1789055344830919`) was authored by the human account, not the bot; **Pax replied and began investigating**; `pax_investigations.note_state = 'linked'` with no note error; the Intercom internal note was attributed to Matt's admin id `10765619`; `esh_ticket_actions` recorded `ask_pax_investigate` = `succeeded`; and re-opening the ticket rendered the existing thread + note state instead of the Ask button.
- **UNVERIFIED:** a second server-side `mode="start"` call on an existing row (UI-level idempotency was observed, the function path was not re-exercised in the human flow), the reconnect-after-expiry path, disconnect, the non-roster / no-connection `409 slackConnectRequired` refusal, the kill-switch-off refusal, and the forced note-failure Retry path.

## Knowledge page: "Sync from app" (9 Sep 2026)

Staging a documentation update used to be possible only from outside the UI — `/knowledge` offered Edit, Save, Review, Approve and a refresh icon that merely re-read the database, so a doc pass could be written but never surfaced for approval by the person reviewing it.

`/knowledge` now has a **Sync from app** button beside Review. It invokes `sync-knowledge-pending` as the signed-in editor, passing `sourceUrl = <origin>/.lovable/project-knowledge.md` **only when the current hostname is one of the two allowlisted project origins** (`SYNC_ALLOWED_HOSTS` in `src/pages/ProjectKnowledge.tsx` mirrors `ALLOWED_SOURCE_HOSTS` in the function — the two must stay in step); otherwise it sends no `sourceUrl` and the function falls back to the published URL. On success the page reloads the row and switches into review mode.

**The approval gate is unchanged.** Sync only writes `pending_content`; the live `content` still changes solely on an explicit Approve. Because the fetch reads the doc served by the running app, the preview origin reflects the current working copy while the published origin reflects the last publish.

## My queue — the personal operational view (10 Sep 2026)

**Why.** v3 was built for clean reporting, not for working tickets. A Support Engineer had no single place answering "what is mine, and which of these is actually waiting on me?" — Triage answers a data-hygiene question, Inbox v3 is a browsing surface, and the owner dashboards report on the past.

**Routes.** `/my-queue` (defaults to the signed-in teammate, matched on the local part of the work email against the active roster) and `/my-queue/:owner` (teammate switcher, roster from `useDashboardTeammates`). New top-level rail item **My queue**, above Issues. `/my/:owner` and `/my-v3/:owner` are untouched — they remain the reporting dashboards.

**Read-only over reporting truth.** `src/pages/MyQueue.tsx` selects from `intercom_tickets_v3` (`state <> 'closed'`, `is_test_ticket` false/null, owner via `normalizeOwner`) and derives every bucket at render time. **No queue state is persisted anywhere** — no new table, no new column, no write to a reporting field — so nothing on this page can move a reported number.

**Who holds the ball.** Taken from Intercom's own conversation statistics carried in `raw_payload.statistics`: `last_contact_reply_at` vs `last_admin_reply_at`. This is the same authorial signal `sla-core` classifies from the message timeline, read from the persisted summary so the page needs no extra Intercom fetch.
- `customer_replied` is **deliberately not used** — it is populated on only 4 of 65 open tickets.
- `first_human_reply_at` is likewise unusable here: the responsiveness fields are computed **at finalize**, so they are null on essentially every open ticket.
- 6 of 65 open rows carry no `statistics` at all. Those are shown in their own **No activity data** bucket rather than being guessed into a state.

**Buckets, in priority order.** Action needed (customer spoke last) → Waiting on engineering (`eng_wait_start_at` set, `eng_wait_end_at` null) → Ready for follow-up (we spoke last and nothing has moved for 3+ days) → Waiting on customer → No activity data. Each bucket is a clickable KPI card that filters the table; rows sort by bucket, then oldest wait first.

**Data hygiene.** A "Missing fields" filter counts rows lacking `Severity`, `Affected Product Area` (falling back to `Product Area`) or `Ticket type` (falling back to `Type`) in `custom_attributes`; the gaps also render as the muted second line under the subject.

**Writes stay where they already live.** The detail sheet embeds the existing `TicketFieldsPanel` (every field write still routes through `esh-write-action`, kill switch and audit unchanged) and `PaxInvestigateControl`. Subjects use the existing Hub-only override path. The queue itself writes nothing.

**Verified 10 Sep 2026** at 1920px: `/my-queue` defaulted to Matt and rendered 26 open tickets — 7 Action needed, 0 Waiting on engineering, 5 Ready for follow-up, 10 Waiting on customer, 4 No activity data, 4 with missing fields. **UNVERIFIED:** the teammate switcher for another owner, and the non-zero Waiting-on-engineering bucket (no open ticket currently has an engineering wait clock).


### Dev escalation buckets and follow-up cadence (11 Sep 2026)

**Why.** Nothing in the Hub said "this ticket is blocked by engineering" or "dev shipped a fix — go tell the customer". `MyQueue` classified engineering waits from `eng_wait_start_at` / `eng_wait_end_at`, which are **finalize-time fields and null on most open tickets**, so CLO-1225 (Intercom `215475556254768`, Linear In Progress with James Gibbs) rendered as *Ready for follow-up*.

**Live join.** `MyQueue.tsx` now reads `public.dev_escalations` by `intercom_conversation_id` for the owner's open tickets — the same Linear mirror `/escalations` uses (`linear_key`, `linear_state`, `linear_state_type`, `linear_assignee`, written only by `sync-linear-escalations`).

**Two new buckets**, placed directly under *Action needed*:
- **Waiting on dev** — `linear_state_type` in backlog / triage / unstarted / started.
- **Dev resolved** — `linear_state_type` completed / canceled while the Intercom ticket is still open, and no human sign-off yet.

A ticket where the customer spoke last stays in *Action needed*: replying to the customer outranks chasing dev. Once a fix is acknowledged the ticket returns to the ordinary conversational buckets.

**Migration 0043** (`dev_escalation_followup_cadence`) adds four nullable, Hub-owned columns to `dev_escalations`, never synced from Linear: `dev_next_followup_at`, `dev_followup_source` (`auto` | `manual`), `dev_fix_ack_at`, `dev_fix_ack_by`, plus an index on the due date.

**Cadence model** (`src/lib/devEscalation.ts`): pre-ack (backlog / triage / unstarted, or unassigned) defaults to **24h**; in flight defaults to **3 days**. Due date = `dev_next_followup_at` when set, otherwise `(dev_followed_up_at ?? created_at) + default`. Overdue rows show **Chase due**, drive the "X need a chase" sub-count on the Waiting-on-dev card and the **Chase dev** filter.

**Controls** (detail sheet, editor-gated by `useCanEdit`): *Mark followed up* applies the lifecycle default; manual overrides are **+1d / +3d / +1w / custom date**; *Acknowledge dev fix* / *Undo* clears a resolved escalation out of the bucket. Every stamp records the signed-in email. **Nothing is written to Intercom, Linear or any reporting column**, and Dev-resolved exit is deliberately manual — no auto-clearing from Intercom activity, because the cross-team comms process is not yet defined.

**Verified 11 Sep 2026** at 2000px on Matt's queue: 5 Action needed, 3 Dev resolved (SCA-3522, IAM-576, ENT-3735 — all Linear Done, all "needs sign-off"), 2 Waiting on dev both Chase due (CLO-1225 In Progress / James Gibbs, CLO-1074 Backlog / unassigned), 1 Ready for follow-up, 6 Waiting on customer, 0 No activity data. **UNVERIFIED:** the write paths (Mark followed up, quick-pick overrides, custom date, Acknowledge dev fix / Undo) have not been exercised against live data; the read-only (non-editor) branch is likewise untested.

#### Workaround provided override (11 Sep 2026)

**Migration 0044** (`dev_escalation_workaround_override`) adds three nullable Hub-owned columns to `dev_escalations`: `dev_workaround_at`, `dev_workaround_by`, `dev_workaround_note`. Never synced from Linear, never written to Intercom.

**Semantics** (`hasWorkaround` / `needsChase` in `src/lib/devEscalation.ts`, bucket rule in `MyQueue.tsx`): a recorded workaround silences the chase clock and takes the ticket **out of Waiting on dev**, back into the ordinary conversational buckets — the Linear escalation card stays visible with the live Linear state. `isDevDone` still wins: a completed / canceled issue resurfaces as **Dev resolved** with *Acknowledge dev fix* even while the workaround flag is set. Clearing the flag restores the normal cadence.

**Controls** (detail sheet, editor-gated): optional note textarea + *Mark workaround provided*; once set the cadence line reads "paused — workaround provided" and the chase buttons are replaced by *Clear workaround*. Row and detail show a **Workaround provided** badge.

**Verified 11 Sep 2026** at 2000px, live writes on Matt's queue: setting it on CLO-1074 (Backlog, unassigned) moved the ticket from Waiting on dev + Chase due to Ready for follow-up (Waiting on dev 2→1, Chase dev 1→0) with the note and who/when rendered; setting it on SCA-3522 (Linear Done) left it in Dev resolved with *Acknowledge dev fix* still offered — the negative case. Both flags were cleared afterwards; `select … where dev_workaround_at is not null` returns 0 rows. **UNVERIFIED:** the read-only (non-editor) branch.

### Detail sheet redesign (11 Sep 2026)

`IssueDetailSheet` (shared by every issue view) now renders the **Intercom conversation ID** in the header as a monospace chip with a one-click copy button next to *Open in Intercom* — it was previously absent from the panel entirely. Two new optional props: `wide` (640 / 760 / 860px at sm / lg / xl instead of the fixed 480px) and `raw` (skip the `<dl>` body wrapper so a page can lay out its own sections). Existing callers are unchanged and keep the 480px `<dl>` behaviour. `IssueStat` is exported for compact label-over-value pairs.

My Queue opts into `wide raw` and groups the body into four bordered cards instead of one flat label/value list: **status** (bucket badge, Chase-due and Missing-fields badges, the "why" line, then a 3-column grid of customer / contact / plan / customer last replied / we last replied / opened), **engineering escalation** (unchanged behaviour), **subject & classification** (`TicketFieldsPanel`), **investigation** (`PaxInvestigateControl`). The subject action row in `TicketFieldsPanel` now wraps instead of overflowing horizontally — that clipping was what hid *Use Intercom's* at 480px. Purely presentational: no query, write path, bucket rule or cadence changed.

### Shared ticket panel (11 Sep 2026)

`src/components/issues/TicketDetailContent.tsx` is now **the one ticket panel**, meant for every surface (My Queue today; Inbox V3, Escalations and future views next). Collapsed by default: a badge row (caller-supplied state pills + Sev / Owner / Area / Type chips, plus a read-only *Esc to eng* chip when Intercom's "Escalated to Engineering" attribute is set), a one-line "why" blurb, the metadata grid, the engineering card, the message cards and the Pax investigation block. A pencil toggles an inline editor that is the existing `TicketFieldsPanel` — every write still goes through `esh-write-action` with unchanged contracts, and **nothing new is written to Intercom**.

**"Escalated to Engineering" stays read-only** by decision: setting it in Intercom exposes a further link text field, so the write-back was deliberately not wired. `esh_write_allowed_actions` is unchanged.

**Option A for a missing escalation:** the engineering card is a slot the caller fills, and it is **omitted entirely** when the ticket has no `dev_escalations` row — no empty "no Linear issue" shell.

**Message cards** (`src/lib/ticketComments.ts`, `TicketCommentCard.tsx`) read the already-persisted `raw_payload` — no new fetch, no Intercom call. *Initial message* comes from `source.body`; *Latest reply* is the last `conversation_parts` entry with `part_type === "comment"` and non-empty body, so internal notes and state changes never surface as a reply. HTML is stripped, whitespace normalised, author and timestamp extracted, and the preview capped at `COMMENT_CAP = 280` characters with *Show more* / *Show less*. The latest card is hidden when it duplicates the initial message.

**Verified 11 Sep 2026** at 2000px on live My Queue tickets: collapsed panel, pencil-expanded editor, a ticket with no escalation (card correctly absent), and both message cards rendering with expansion. No horizontal scroll.
