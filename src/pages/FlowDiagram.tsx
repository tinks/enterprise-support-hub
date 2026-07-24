import AppLayout from "@/components/AppLayout";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  MarkerType,
  useNodesState,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  Bot,
  Mail,
  MousePointerClick,
  Ticket,
  ThumbsUp,
  ThumbsDown,
  User,
  Users,
  CheckCircle2,
  Beaker,
  ScrollText,
  Download,
} from "lucide-react";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import EditableFlowNode, { type FlowNodeData } from "@/components/EditableFlowNode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const nodeTypes = { flowNode: EditableFlowNode };

const COL_W = 420;
const ROW_H = 380;

/* ------------------------------------------------------------------ */
/*  Design: Lovable brand palette — coral #FF6B6B, pink #E66FD2,       */
/*  purple #9B87F5. Charts use these for Slack/Gmail/resolution.       */
/* ------------------------------------------------------------------ */
/*  Navigation: Left sidebar (AppLayout) — collapsed to 56px icons,    */
/*  auto-expands to 200px on hover, collapses on mouse leave.          */
/*  Vertical gradient accent bar on the left edge.                     */
/*  "Dashboards" flyout group: Joel & Kristina are under a single      */
/*  Dashboards nav item with a hover flyout submenu (no extra clicks). */
/* ------------------------------------------------------------------ */
/*  Gmail resolve & toggleTest: optimistic UI update with error        */
/*  handling — reverts state and shows toast on failure. No `as any`.  */
/* ------------------------------------------------------------------ */
/*  Intercom reply routing: slack-events always uses                    */
/*  intercom_conversation_id (never ticket_id) for /reply endpoint.    */
/*  Ticket IDs are invalid for replies. Retry-as-admin uses same ID.   */
/* ------------------------------------------------------------------ */
/*  Product areas are user-configurable via Settings page. The         */
/*  Conversations page fetches the list from settings.product_areas.   */
/* ------------------------------------------------------------------ */
/*  Column headers in the Conversations table are drag-and-drop        */
/*  reorderable. Order persists in localStorage (conv-column-order).   */
/*  A "Reset columns" button restores the default order.               */
/* ------------------------------------------------------------------ */
/*  Stats page: "Export PDF" button generates a PDF report with all    */
/*  summary metrics and chart screenshots, respecting active filters. */
/* ------------------------------------------------------------------ */
/*  Conversation detail page: 70/30 split layout. Left 70% shows      */
/*  channel/sender info + threaded messages. Right 30% sticky sidebar  */
/*  has status, classification, links, timeline, and raw IDs cards.    */
/*  Responsive: stacks vertically on small screens.                    */
/* ------------------------------------------------------------------ */
/*  Imported Slack threads: import-slack-thread fetches ALL replies    */
/*  and computes first-response-time + thread duration. It also       */
/*  resolves the Slack user's display name via users.info and caches  */
/*  it in the slack_user_name column for permanent display. A "Create */
/*  Intercom ticket" button on ConversationDetail calls               */
/*  create-intercom-from-import to create a ticket with full          */
/*  transcript, assign to Sam + inbox, and link back to mapping.      */
/* ------------------------------------------------------------------ */
/*  Import auto-join: if the bot isn't in the target channel,         */
/*  import-slack-thread attempts conversations.join (public channels) */
/*  and retries. For private channels it returns a clear error asking */
/*  the user to /invite @Ask Lovable.                                 */
/* ------------------------------------------------------------------ */
/*  Import error handling: supabase.functions.invoke returns data even */
/*  on non-2xx responses. ImportTab now checks data.existingId on     */
/*  error to show "Already imported" toast with a View link, and      */
/*  falls back to data.error for other structured messages (e.g. bot  */
/*  not in channel).                                                   */
/* ------------------------------------------------------------------ */
/*  Conversation search is server-side: when a search query is active, */
/*  all three tables are queried with ilike filters (+ exact id match  */
/*  for UUIDs), bypassing client-side pagination. Results debounced    */
/*  at 300ms, limited to 200 rows per source. For manual convos,       */
/*  search also queries manual_messages.message_text so you can find   */
/*  conversations by what was said inside the thread, not just metadata.*/
/* ------------------------------------------------------------------ */
/*  Conversations date filter: from/to date pickers filter rows        */
/*  server-side via .gte/.lte on created_at/received_at. Client-side   */
/*  filtering also applied. Reload triggers on date change.            */
/* ------------------------------------------------------------------ */
/*  Source labels: Slack rows with an intercom_conversation_id show     */
/*  "Slack bot"; rows without show "Slack import". Filter dropdown     */
/*  uses matching labels. "Create" button appears for rows without ID. */
/* ------------------------------------------------------------------ */
/*  Gmail grouping: emails with matching gmail_thread_id (or normalized */
/*  subject after stripping Re:/Fwd:) are collapsed into a single row  */
/*  showing count badge and unique senders. Click to expand sub-rows.  */
/* ------------------------------------------------------------------ */
/*  Intercom column: click the pencil icon on any Intercom cell to     */
/*  inline-edit the conversation ID. Works for Slack, Gmail, and       */
/*  Manual sources. Uses explicit edit button instead of double-click  */
/*  to avoid conflicts with Gmail row expand/collapse behavior.        */
/* ------------------------------------------------------------------ */
/*  Multi-source detail view: /conversations/:id accepts ?source=      */
/*  gmail or ?source=manual query param. Gmail detail shows email      */
/*  metadata (from, to, cc, subject, snippet). Manual detail shows     */
/*  contact info and full message transcript. All sources support      */
/*  classification, status changes, and Intercom ticket creation.      */
/* ------------------------------------------------------------------ */
/*  Create Intercom ticket: the create-intercom-from-import edge       */
/*  function accepts { mappingId, source } where source can be         */
/*  "slack" (default), "gmail", or "manual". Gmail uses from_email     */
/*  for contact lookup; manual uses contact_name. The "Create" button  */
/*  appears in the Intercom column for all sources without an ID.      */
/* ------------------------------------------------------------------ */
/*  Intercom import: users can paste an Intercom conversation URL on   */
/*  the Import page to create a manual_conversation with source =      */
/*  "intercom", pre-linked intercom_conversation_id, and metadata      */
/*  fetched from the Intercom API. Duplicates checked across all       */
/*  three tables. Badge shows "Intercom import" in conversations list. */
/*  Imported conversations use the first user message timestamp as     */
/*  created_at instead of the import time, so analytics reflect when   */
/*  the conversation actually started.                                  */
/* ------------------------------------------------------------------ */
/*  Intercom dedup: unique partial index on intercom_conversation_id   */
/*  prevents duplicate manual_conversations from concurrent webhooks.  */
/*  Webhook uses upsert (onConflict) so second event gracefully no-ops.*/
/* ------------------------------------------------------------------ */
/*  Bulk import: /import/bulk page accepts Intercom CSV exports,        */
/*  parses client-side, matches against all 3 conversation tables       */
/*  (exact intercom_conversation_id + fuzzy subject). Rows marked       */
/*  Tracked / Possible duplicate / Missing. Selected missing rows are   */
/*  imported via bulk-import-intercom edge function in batches of 10.   */
/*  Owner auto-set from CSV "Teammate currently assigned" column.       */
/* ------------------------------------------------------------------ */
/*  Owner tracking: each conversation (Slack, Gmail, Manual) has an    */
/*  owner column (Joel, Kristina, Sam, or CSM). Assignable inline      */
/*  from the Conversations table and the detail view Classification    */
/*  card. Owner filter dropdown lets users filter by owner or          */
/*  unassigned. CSM is used for non-technical-support questions.        */
/*  Teammate roster (canonical): public.teammates is the single source  */
/*  of truth for who's who — intercom_admin_id (unique), email, name,   */
/*  role (support|other|ai), active. Seeded with 5 support + Sam(ai);   */
/*  Joel active=false (departed). `active` is roster status ONLY — it   */
/*  does NOT affect SLA counting; historical replies always count.      */
/*  role IS load-bearing: role='support' is the roster the SLA engine   */
/*  uses for First Response (see Track B), and role='ai' (Sam) is       */
/*  thereby excluded from it. Managed from Settings → Teammates card    */
/*  (admin-gated writes via has_role).                                  */

/*  Admin→owner mapping (LEGACY, still live): settings.admin_owner_map  */
/*  stores a JSON map of Intercom admin IDs to owner names. It remains  */
/*  the reader for owner auto-attribution in intercom-webhook,          */
/*  poll-intercom-inbox, sync-v3-open, sync-v3-closed, sync-inbox-v2,   */
/*  backfill-enterprise-inbox and AnalyticsV3. The Teammates card       */
/*  DUAL-WRITES every mutation into the blob (all rows, active and      */
/*  inactive) so attribution can't drift while those readers are        */
/*  repointed at `teammates` in a later tech-debt pass.                 */

/* ------------------------------------------------------------------ */
/*  Inbox row color-coding (Conversations table):                      */
/*  1. Coral left border + bg  → no owner assigned (highest priority)  */
/*  2. Amber left border + bg  → status is awaiting_support (customer  */
/*     replied and team needs to act)                                   */
/*  3. No highlight            → all other rows                        */
/* ------------------------------------------------------------------ */
/*  Auto-status transitions: on every reply, the system automatically  */
/*  updates the conversation status:                                   */
/*  - Admin reply (Joel, Kristina, or Sam) → status = awaiting_customer*/
/*  - Customer reply → status = awaiting_support                       */
/*  This applies across all sources: Slack (slack-events), Intercom    */
/*  (intercom-webhook for both conversation_mappings and               */
/*  manual_conversations), and Gmail (via Intercom webhook path).      */
/* ------------------------------------------------------------------ */
/*  Manual thread timestamps: when pasting a Slack/Teams thread, the   */
/*  parser captures per-message timestamps (e.g. "1:47 PM", "Mar 26th */
/*  at 11:03 AM", "3/26/2025 11:03 AM"). These are combined with the  */
/*  user-picked thread date to set each manual_message.created_at to   */
/*  the actual send time instead of the import time. The AI fallback   */
/*  parser also returns sent_at timestamps when visible in the text.   */
/* ------------------------------------------------------------------ */
/*  Outbound replies: the ConversationDetail page has a "Reply to      */
/*  customer" composer that sends messages via the post-reply edge     */
/*  function. Routes to the correct platform:                           */
/*  - Intercom: POST /conversations/{id}/reply as admin                */
/*  - Slack: chat.postMessage to the thread                            */
/*  - Gmail: messages.send with In-Reply-To/References headers         */
/*  After sending, status is set to awaiting_customer. For Slack and    */
/*  Gmail conversations with a linked Intercom ticket, the reply is    */
/*  also forwarded to Intercom to keep both channels in sync.           */
/* ------------------------------------------------------------------ */
/*  Audit logs: every field change on ConversationDetail (status,      */
/*  owner, product area, classification, test/incident toggles,        */
/*  Intercom linking, replies) is recorded in conversation_audit_logs  */
/*  with who made the change and when. A tabbed interface below the    */
/*  thread (Reply / Notes / Activity) shows the full history.          */
/* ------------------------------------------------------------------ */
/*  Owner dashboards: /my/joel and /my/kristina show personal views    */
/*  with KPI cards (open, resolved, bugs, feature requests) and a     */
/*  focused conversation table scoped to the owner. Accessible from   */
/*  the top nav bar.                                                   */
/* ------------------------------------------------------------------ */
/*  Classification column: single-select dropdown (Issue, Configuration,*/
/*  Bug, FR, Question) on all three tables. Separate from the Bug      */
/*  toggle which remains as-is. Stored in `classification` text column.*/
/*  The FR toggle was removed; feature requests are now tracked via    */
/*  the Classification dropdown with the "FR" option.                  */
/* ------------------------------------------------------------------ */
/*  Re-import old bot conversations: /test-review page lists convos    */
/*  from old bot channels (e.g. C0AJP396C85). import-slack-thread     */
/*  accepts force=true to update existing rows and sets created_at     */
/*  from slack_thread_ts so analytics reflect the actual thread date.  */
/*  Relink: passing existingId + force + a new URL fully overwrites    */
/*  slack_channel_id, slack_thread_ts, slack_user_id, message text,    */
/*  and created_at — effectively relinking the row to a new thread.    */
/*  Duplicate cleanup: /test-review has a per-row "Dupes" search that  */
/*  finds matching manual_conversations and lets you delete them.      */
/*  Log & replace: per-row button opens dialog to paste a Slack thread */
/*  text, saves as manual_conversation + manual_messages, then deletes */
/*  the old conversation_mappings row via delete-conversation-mapping   */
/*  edge function (service-role). Copies owner from original row.      */
/*  Test review rows are clickable → navigate to /conversations/:id.   */
/*  Delete conversation: available for ALL sources (slack, gmail,       */
/*  manual) from the detail page. Uses delete-conversation-mapping      */
/*  edge function with a `table` param for slack/gmail (RLS blocks     */
/*  public DELETE). Manual uses client-side delete.                     */
/* ------------------------------------------------------------------ */
/*  Analytics drill-down: clicking a data point on the conversation    */
/*  volume chart navigates to /conversations?day=YYYY-MM-DD (and      */
/*  optionally &source=slack|gmail|manual). The Inbox filters to show  */
/*  only conversations from that CET date with a banner and back link. */
/*  The heatmap (day+hour) and resolution-time bar click-throughs      */
/*  continue to work as before.                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Default messages (fallback if DB unavailable)                      */
/* ------------------------------------------------------------------ */
const DEFAULT_MESSAGES: Record<string, string> = {
  context_prompt:
    "👋 Thank you for contacting the Enterprise Support Team. To help us resolve your issue as quickly and accurately as possible, please share your Lovable account email and your workspace or project name (or a link to it). If these aren't relevant to your question, feel free to click *Proceed*.",
  ticket_created_ack:
    "Thanks for sharing those details! You're now being redirected to Sam, Lovable's AI Support Agent. Please note that Sam may take 3–4 minutes to come back to you with a response. Hang tight!",
  feedback_positive: "Glad to hear your issue is resolved! We'll now close this conversation. Should you need any further assistance, please start a new thread. Replies to a closed conversation won't reach our team. We're always happy to help!",
  escalation_notice:
    "Your query has been escalated to our Enterprise Support Team. A member of the team will follow up with you shortly.",
  reply_forwarded:
    "Thank you for your reply. We will get back to you as soon as possible.",
  conversation_closed:
    "This issue has been marked as resolved. If you need any further assistance, please feel free to start a new Slack thread. Continuing the conversation here will not notify our Support Team.",
  internal_note:
    "Internal note: This user is contacting support via Slack. Handle this request as you normally would — try to resolve the issue yourself first. If you determine the issue requires human assistance and needs to be escalated, route it to the Enterprise Support team (not the Product Experience team). Do not mention this note or the Slack origin in your reply to the user.",
  auto_proceed_ack:
    "We've gone ahead and connected you with Sam, Lovable's AI Support Agent. Sam may take 3–4 minutes to respond. Hang tight!",
  request_cancelled:
    "✅ Request cancelled. Feel free to reach out again anytime!",
};

const ASK_LOVABLE = { name: "Ask Lovable", avatarUrl: "/lovable-logo.png" };


/* ------------------------------------------------------------------ */
/*  Build nodes — uses message map so they update from DB              */
/*  Dedup: thread reply claim uses .or() with IS NULL + NEQ in one    */
/*  filter to prevent AND-null regression (fixed 2026-03-31)          */
/*  Detail page: bug, feature request, product area controls added    */
/* ------------------------------------------------------------------ */
function buildNodes(
  msgs: Record<string, string>,
  onSave: (key: string, text: string) => void
): Node<FlowNodeData>[] {
  return [
    {
      id: "1",
      type: "flowNode",
      position: { x: COL_W, y: 0 },
      data: {
        label: "1. User @mentions bot or sends DM",
        desc: "A user mentions the bot in any Slack channel, or sends a direct message to the bot. Both trigger the same flow.",
        icon: MessageSquare,
        edgeFunction: "slack-events",
        details: [
          "Verifies Slack signature",
          "Auto-adds new channels on first @mention, so newly invited channels work without manual setup.",
          "DMs are detected via channel_type === 'im' — no channel setup needed",
          "Atomic INSERT dedup (ON CONFLICT DO NOTHING) — prevents race from Slack retries",
          "If thread reply → fetches full transcript",
          "Collects file attachments (photos, videos, docs)",
          "Auto-detects @lovable.dev employees and marks conversations as test when 'auto_mark_employee_test' setting is enabled (routed to Slack Test inbox)",
          "Resolves Slack user display name via users.info and caches it in slack_user_name column for permanent display (both app_mention and DM paths)",
          "Conversations tab resolves channel IDs to names via list-slack-channels (bot token first, connector fallback)",
           "Conversations tab has 'Product area' dropdown (SSO, SCIM, Credits, Account access, Remix/transfer, Cloud/AI), 'Bug' toggle, and 'Feature request' toggle per row, persisted to DB",
           "Conversations tab has multi-select status filter (popover with checkboxes) to hide/show: active, awaiting_context (labelled 'Awaiting customer'), awaiting_support, escalated, resolved, cancelled, test — defaults to hiding test, cancelled, resolved",
            "Inbox table has column-level filter popovers on Owner, Product area, and Classification headers — each with All, Unassigned, and specific value options. Filters persist in localStorage. Owner filter moved from top bar to column header. Insights Owner load drilldowns open with source/product/classification/search/status filters cleared, test rows excluded, and Gmail grouped by the same earliest-thread row used in report counts.",
            "Resolution distribution chart bars on Analytics page are clickable — clicking navigates to Inbox filtered by resolution time bucket (e.g. < 15m, 15m–1h) showing matching Slack conversations",
           "Status display labels: awaiting_context → 'Awaiting customer', awaiting_support → 'Awaiting support' (DB values unchanged)",
           "Status is editable inline from the conversations list via a dropdown (active, resolved, cancelled, escalated, awaiting_context, awaiting_support)",
           "Manual log also supports 'Paste thread' mode: paste a full copied Slack or Teams thread. Parser handles formats: 'Name [HH:MM AM/PM]', 'Name\\nMar 26th at HH:MM AM/PM', 'Name  HH:MM AM/PM', and Teams 'Name  MM/DD/YYYY HH:MM AM/PM'. If all regex formats fail, AI fallback (parse-thread edge function) extracts messages. Auto-detects admin vs user role, date picker sets created_at for accurate analytics dating. Source options include Slack, Teams, SAP, phone, and other. All import paths (paste, single Intercom, bulk Intercom, webhook auto-import) derive created_at from the earliest message timestamp at INSERT time to prevent date drift in analytics.",
        ],
        message: "@SupportBot I'm having trouble deploying my project...",
        accent: "blue",
      },
    },
    {
      id: "2",
      type: "flowNode",
      position: { x: COL_W, y: ROW_H },
      data: {
        label: "2. Bot posts context prompt",
        desc: "Bot replies with three buttons: add context, proceed immediately, or cancel. Saves prompt_message_ts for later updates.",
        icon: Bot,
        edgeFunction: "slack-events",
        message: msgs.context_prompt,
        messageKey: "context_prompt",
        onMessageSave: onSave,
        botIdentity: ASK_LOVABLE,
        status: "awaiting_context",
        accent: "blue",
        details: [
          "Posts Block Kit message with 'Add Details', 'Proceed', and 'Cancel' buttons",
          "Saves prompt_message_ts to conversation_mappings for later chat.update",
          "If no action after 15 min → cron posts reminder in thread (only if prompt_message_ts exists and no Intercom ticket yet)",
          "If no action after 30 min → cron auto-proceeds (only bot-flow convos with prompt_message_ts, never manually-set 'Awaiting customer')",
        ],
      },
    },
    {
      id: "3a",
      type: "flowNode",
      position: { x: COL_W - COL_W * 0.75, y: ROW_H * 2 },
      data: {
        label: '3a. "Add Details" clicked',
        desc: "Opens a Slack modal for email + project link.",
        icon: Mail,
        edgeFunction: "slack-interactions",
        details: [
          "Modal opened first (time-sensitive trigger_id)",
          "Prompt message updated to '⏳ Gathering your details…' via chat.update (single bot avatar)",
          "promptMessageTs stored in modal private_metadata",
          "Modal: Email + Project Link fields",
          "On submit → updates prompt message to ack via chat.update, creates Intercom ticket",
          "On failure → resets status to awaiting_context, restores prompt with buttons, posts error message",
        ],
        message: "📧 user@example.com\n🔗 https://lovable.dev/projects/...",
        accent: "blue",
      },
    },
    {
      id: "3b",
      type: "flowNode",
      position: { x: COL_W + COL_W * 0.75, y: ROW_H * 2 },
      data: {
        label: '3b. "Proceed" clicked',
        desc: "Skips modal, creates ticket with original message only.",
        icon: MousePointerClick,
        edgeFunction: "slack-interactions",
        details: [
          "Updates prompt message to ack text via chat.update (single bot avatar)",
          "Creates Intercom ticket immediately",
          "On failure → resets status to awaiting_context, restores prompt with buttons, posts error message",
        ],
        accent: "blue",
      },
    },
    {
      id: "3c",
      type: "flowNode",
      position: { x: COL_W + COL_W * 1.55, y: ROW_H * 2 },
      data: {
        label: '3c. "Cancel" clicked',
        desc: "User dismisses the support request. No Intercom ticket is created.",
        icon: CheckCircle2,
        edgeFunction: "slack-interactions",
        details: [
          "Atomic guard: updates status to 'cancelled' only if currently awaiting_context",
          "Updates prompt message to cancellation acknowledgment via chat.update",
          "No Intercom ticket created, no reactions added",
        ],
        message: msgs.request_cancelled,
        messageKey: "request_cancelled",
        onMessageSave: onSave,
        botIdentity: ASK_LOVABLE,
        status: "resolved",
        accent: "green",
      },
    },
    {
      id: "4",
      type: "flowNode",
      position: { x: COL_W, y: ROW_H * 3.2 },
      data: {
        label: "4. Intercom ticket created",
        desc: "Bot creates an Intercom conversation and assigns it to the AI agent.",
        icon: Ticket,
        edgeFunction: "slack-interactions",
        details: [
          "Adds 👀 reaction to original message",
          "Searches Intercom contact by email first; falls back to external_id only when no email provided",
          "Creates contact by email only (no external_id) to prevent race conditions merging different emails into one contact",
          "On conflict: reuses existing contact WITHOUT overwriting its email — each email stays separate",
          "Downloads & re-hosts file attachments to storage",
          "Prepends anti-escalation context (enterprise Slack origin) to conversation body",
          "Creates conversation with text + attachment URLs",
          "Assigns to AI agent + moves to enterprise team inbox",
          "Sets Slack channel + Enterprise Support attributes",
        ],
        message: msgs.ticket_created_ack,
        messageKey: "ticket_created_ack",
        onMessageSave: onSave,
        botIdentity: ASK_LOVABLE,
        reactions: ["👀"],
        status: "active",
        accent: "blue",
        wide: true,
        secondaryMessage: msgs.internal_note,
        secondaryMessageKey: "internal_note",
        secondaryLabel: "Injected context (hidden from user)",
      },
    },
    {
      id: "5",
      type: "flowNode",
      position: { x: COL_W, y: ROW_H * 4.5 },
      data: {
        label: "5. AI responds → posted to Slack",
        desc: "After ticket creation, polls Intercom API for Sam's reply and relays it to Slack with feedback buttons (unless Sam auto-escalates). Webhook serves as fallback for human admin replies.",
        icon: Bot,
        edgeFunction: "slack-interactions → poll",
        details: [
          "Proactive polling: after creating ticket, polls Intercom API at 10s/20s/30s/60s intervals",
          "Relays Sam's initial reply directly to Slack (bypasses webhook)",
          "Atomic dedup: claims last_intercom_part_id BEFORE posting to Slack — prevents duplicate messages when webhook or concurrent poll fires simultaneously",
           "Both polling and webhook skip internal notes (part_type=note) to prevent interim messages leaking to Slack",
           "Slack-origin guard: webhook skips replies containing '[From: … via Slack]' prefix to prevent echo-back of Slack-originated messages",
           "Escalation marker guard: webhook skips its own customer-side 'awaiting human support response' marker so Intercom cannot loop it back to Slack",
           "Webhook fallback: intercom-webhook handles human admin replies + subsequent messages",
           "Admin follow-ups on resolved conversations reopen them (status → awaiting_customer, resolved_at cleared) — enables Sam's snooze→reply→close workflow tracking",
           "Webhook dedup is monotonic: only newer part IDs can claim last_intercom_part_id (lt guard), so stale retries cannot re-post the same Sam reply",
          "Removes old feedback buttons from thread", 
          "Posts reply (split at 2900 chars)",
          "Forwards Intercom attachments + inline images (deduped) to Slack",
          "Detects incident.io action → fetches live status from status.lovable.dev and posts status block with subscribe link",
           "Detects escalation keywords only in Sam/admin AI replies → if Sam routes to humans, buttons are omitted and status set to escalated",
           "Detects duplicate ticket merge (reply starts with 'I can see you already have open tickets about') → all buttons omitted",
           "Filters out internal notes (part_type=note) so interim messages like 'Sam is working…' are never posted to Slack",
           "Hides '👎 Escalate' button if status is already escalated or reply is from a human admin",
          "Otherwise appends feedback buttons to last chunk",
        ],
        message:
          "[AI reply text...]\n\n[ 👍 This resolved my issue ]  [ 👎 Escalate to human ]\n\n_To continue chatting with Sam, please send a reply in the thread_",
        botIdentity: ASK_LOVABLE,
        accent: "blue",
        wide: true,
      },
    },
    {
      id: "6a",
      type: "flowNode",
      position: { x: COL_W - COL_W * 0.85, y: ROW_H * 5.9 },
      data: {
        label: "6a. 👍 Positive feedback",
        desc: "User confirms AI resolved their issue.",
        icon: ThumbsUp,
        edgeFunction: "slack-interactions",
        details: [
          "Atomic guard: updates status to 'resolved' only if currently active/awaiting_context — second click is a no-op",
          "Removes feedback buttons",
          "Removes 👀 and ⏳, adds ✅",
          "Fetches current conversation assignee from Intercom, closes as that admin (human agent gets credit; falls back to Sam if no assignee)",
        ],
        message: msgs.feedback_positive,
        messageKey: "feedback_positive",
        onMessageSave: onSave,
        botIdentity: ASK_LOVABLE,
        reactions: ["✅"],
        status: "resolved",
        accent: "green",
      },
    },
    {
      id: "6c",
      type: "flowNode",
      position: { x: COL_W + COL_W * 0.85, y: ROW_H * 5.9 },
      data: {
        label: "6c. User replies in thread",
        desc: "User replies without clicking a button. Atomically transitions status to active_pending to gate the notice, then triggers another AI response — repeats until 👍 or 👎.",
        icon: MessageSquare,
        edgeFunction: "slack-events",
        details: [
          "Returns 200 immediately; processes in background via EdgeRuntime.waitUntil()",
          "Idempotency: deduplicates by event.ts to prevent Slack retry duplicates",
          "Removes old feedback buttons from thread",
          "Resolves sender identity via Slack users.info (name + email)",
          "Sender attribution: employee (@lovable.dev) → admin reply using their real Intercom admin ID (hardcoded map); original requester → customer reply (unchanged); other → customer reply with name prefix",
          "Atomic status gate: active → active_pending (skips notice if already pending)",
          "Posts '⏳ Sam is writing a response...' only on successful transition",
          "Downloads & re-hosts any attached files",
          "Loop continues until user clicks 👍 or 👎",
          "Status reset: intercom-webhook resets active_pending → active on reply",
        ],
        accent: "blue",
        targetPosition: "left",
        sourcePosition: "top",
      },
    },
    {
      id: "6b",
      type: "flowNode",
      position: { x: COL_W, y: ROW_H * 5.9 },
      data: {
        label: "6b. 👎 Escalate to human",
        desc: "User requests human support. Converts conversation to ticket.",
        icon: ThumbsDown,
        edgeFunction: "slack-interactions",
        details: [
          "Atomic guard: updates status to 'escalated' only if currently active/awaiting_context — second click is a no-op",
          "Removes feedback buttons",
          "Removes 👀, adds ⏳",
          "Reassigns to enterprise team inbox",
          "Converts conversation to ticket",
        ],
        message: msgs.escalation_notice,
        messageKey: "escalation_notice",
        onMessageSave: onSave,
        botIdentity: ASK_LOVABLE,
        reactions: ["⏳"],
        status: "escalated",
        accent: "orange",
      },
    },
    {
      id: "6bi",
      type: "flowNode",
      position: { x: COL_W - COL_W * 0.5, y: ROW_H * 7.3 },
      data: {
        label: "6b-i. Human replies in Slack",
        desc: "After escalation (👎), user replies in Slack → forwarded to Intercom. Atomically gates the notice via escalated → escalated_pending.",
        icon: User,
        edgeFunction: "slack-events",
        details: [
          "Returns 200 immediately; processes in background via EdgeRuntime.waitUntil()",
          "Idempotency: deduplicates by event.ts to prevent Slack retry duplicates",
          "Only triggers when status is 'escalated'",
          "Atomic status gate: escalated → escalated_pending",
          "Resolves sender identity via Slack users.info (name + email)",
          "Sender attribution: employee → admin reply using real Intercom admin ID; original requester → customer reply; other → customer reply with name prefix",
          "Downloads & re-hosts any attached files",
          "Removes remaining feedback buttons",
          "Posts 'reply forwarded' notice only on successful transition",
          "Status reset: intercom-webhook resets escalated_pending → escalated on reply",
        ],
        message: msgs.reply_forwarded,
        messageKey: "reply_forwarded",
        onMessageSave: onSave,
        botIdentity: ASK_LOVABLE,
        accent: "orange",
      },
    },
    {
      id: "6bii",
      type: "flowNode",
      position: { x: COL_W + COL_W * 0.6, y: ROW_H * 7.3 },
      data: {
        label: "6b-ii. Human replies from Intercom",
        desc: "Agent replies in Intercom → posted to Slack with resolve button. Can repeat indefinitely.",
        icon: Bot,
        edgeFunction: "intercom-webhook",
        details: [
          "Removes old feedback buttons",
          "Posts reply with admin identity",
          'Shows only "Resolved" button (no escalate)',
        ],
        message:
          "[Agent reply text...]\n\n[ 👍 This resolved my issue ]",
        botIdentity: ASK_LOVABLE,
        accent: "orange",
      },
    },
    {
      id: "7",
      type: "flowNode",
      position: { x: COL_W + COL_W * 0.05, y: ROW_H * 8.7 },
      data: {
        label: "7. Conversation / Ticket closed",
        desc: "Conversation or ticket closed in Intercom → thread finalized in Slack.",
        icon: CheckCircle2,
        edgeFunction: "intercom-webhook",
        details: [
          "Handles conversation.admin.closed & ticket.state.updated",
          "Filters ticket.state.updated to only resolved/closed states (via ticket_state.category)",
          "Slack-originated: removes feedback buttons, swaps reactions to ✅, posts resolution notice",
          "Manual/Gmail fallback: if no Slack mapping found, resolves matching manual_conversations or gmail_conversations by intercom_conversation_id",
        ],
        message: msgs.conversation_closed,
        messageKey: "conversation_closed",
        onMessageSave: onSave,
        botIdentity: ASK_LOVABLE,
        reactions: ["✅"],
        status: "resolved",
        accent: "green",
      },
    },
    {
      id: "intercom-auto",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: 0 },
      data: {
        label: "Auto-import on Intercom assignment",
        desc: "When a conversation is assigned to the enterprise inbox in Intercom, the webhook cross-references Gmail records by contact email before creating a manual entry.",
        icon: Ticket,
        edgeFunction: "intercom-webhook",
        details: [
"Listens for assignment webhook topics: conversation.admin.assigned, conversation.admin.open.assigned, ticket.admin.assigned, ticket.team.assigned",
           "STRICT inbox guard: 1) team_assignee_id matches enterprise inbox → proceed, 2) API fallback: fetch conversation and recheck team_assignee_id → proceed. The previous admin_owner_map fallback was REMOVED — conversations assigned to Joel/Kristina/Sam from other inboxes are no longer auto-imported.",
           "Deduplicates across conversation_mappings, gmail_conversations, and manual_conversations",
          "Fetches full conversation from Intercom API with pagination",
          "Gmail cross-reference: extracts contact email from conversation source or contacts API, searches gmail_conversations for unlinked records matching from_email/to_emails/cc_emails — if found, links the Gmail thread with intercom_conversation_id and skips manual_conversations insert",
          "Subject-based fallback link: when email lookup returns nothing (mail relayed via the enterprise-support@lovable.dev Google Group strips the customer address), the webhook normalizes the Intercom ticket subject (strip Re:/Fwd:, lowercase, collapse whitespace) and matches it against unlinked gmail_conversations from the last 24 h. Exactly-one matching gmail_thread_id → link the whole thread; 0 or >1 → log subject_link_ambiguous and fall through to manual creation",
          "Fallback: if no Gmail match, extracts messages (skips bots, notes, system events) and inserts into manual_conversations (source='intercom') + manual_messages",
          "Conversations from other channels (web, mobile, non-enterprise email) get tracked automatically",
          "Live reply tracking: subsequent replies (admin AND customer) in Intercom are appended to manual_messages via webhook. REPLY_TOPICS includes conversation.admin.replied, conversation.admin.single.reply, ticket.admin.replied, conversation.user.replied, conversation.user.created, conversation.operator.replied, ticket.contact.replied. Gmail-linked conversations also get status updates (awaiting_customer/awaiting_support) from Intercom replies",
          "Reply reconciliation safety net: pg_cron runs backfill-intercom-replies?recent=true every 5 minutes against manual + gmail rows updated/received in the last 7 days (capped at 200) — catches any reply webhook that was dropped, raced, or arrived on a topic outside the whitelist",
          "Auto-owner: resolves admin_assignee_id via settings.admin_owner_map (JSON) to set owner at import time; also updates owner on already-tracked conversations (conversation_mappings, gmail_conversations, manual_conversations) when reassigned in Intercom",
        ],
        accent: "orange",
      },
    },
    {
      id: "gmail",
      type: "flowNode",
      position: { x: COL_W * 2.6, y: 0 },
      data: {
        label: "Gmail polling",
        desc: "Edge function polls Gmail DL every 15 min, stores email metadata in gmail_conversations table, and exposes structured failure categories for credential/scope diagnostics.",
        icon: Mail,
        edgeFunction: "poll-gmail",
        details: [
          "Runs on pg_cron schedule every 15 minutes",
          "Uses custom Google OAuth 2.0 (client ID + secret stored as secrets, tokens in gmail_oauth_tokens)",
          "Preflight check calls users/me/profile before listing messages",
          "Calls Gmail API directly (newer_than:1d)",
          "Classifies failures as oauth_tokens, token_refresh, scope_permission, gmail_transport, or database",
          "Auto-refreshes expired access tokens using the stored refresh token",
          "Deduplicates by unique gmail_message_id (duplicate inserts are skipped)",
          "Captures To and CC headers for customer domain analytics (stored as to_emails, cc_emails)",
          "Tracks gmail_last_polled_at high-water mark in settings table",
           "Stats page deduplicates by gmail_thread_id: one row per thread is used for all KPIs (Email total, volume charts, resolved/open counts, customer domains). Raw message rows are only used for resolution time grouping.",
           "Internal-only threads (all participants @lovable.dev) are excluded from all Gmail metrics — Email total, Gmail messages, Gmail open, resolution times, customer domains",
           "Recently imported list (ImportTab) deduplicates Gmail entries by gmail_thread_id — only the latest message per thread appears",
           "Activity by hour of day (CET): bar chart on Stats page shows Slack + Gmail activity bucketed by hour using Europe/Berlin timezone",
           "Activity heatmap: 7×24 grid (Mon–Sun × 00–23 CET) with color intensity showing conversation density; respects source filter; tooltip shows Slack + Gmail breakdown; cells are clickable — navigates to /conversations filtered by that day+hour",
           "Heatmap drill-down: Conversations page detects day+hour query params → loads up to 1000 rows/source (vs default 50), filters client-side by CET day+hour, shows filter banner with 'Back to stats' (→ /) and 'Clear filter' buttons, hides 'Load more'",
          "Hybrid resolution tracking: emails have status (open/resolved) and resolved_at timestamp",
          "Manual resolve: users can mark Gmail threads as resolved from Conversations UI",
          "Auto-close: pg_cron runs hourly — threads with no new messages for 24h are auto-resolved",
           "Resolution time = resolved_at minus earliest received_at in the thread",
           "Manual override: users can edit resolved_at directly on the Conversation detail page (Timeline → Resolved) for slack/gmail/manual sources — backdating auto-flips status to 'resolved' so analytics reflect reality; clearing reverts status to active/open. Local only — does not close the upstream Intercom/Gmail/Slack ticket. Audited as 'updated_resolved_at'.",
          "Stats page shows Gmail resolved/open counts and median/avg resolution time — both are deduplicated by subject (same thread = 1 count), matching the 'Email total' dedup logic",
           "Thread metadata inheritance: new messages in an existing thread automatically inherit owner, classification, product area, incident/feature flags, and Intercom link from the most recent sibling",
           "Read-only: no replies from dashboard",
           "Auto-Intercom lookup: when a Gmail thread detail page loads without an intercom_conversation_id, the system searches Intercom by customer email (auto-detects customer vs support DL) AND by email subject, deduplicates results, strips HTML from titles — user can link with one click, syncs to sibling threads",
           "Import tab: paste a Slack thread URL to manually import it as a conversation — the edge function parses the URL, fetches the thread parent from Slack, and inserts a conversation_mappings row with status 'active'",
        ],
        accent: "orange",
      },
    },
    {
      id: "intercom-poller",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H },
      data: {
        label: "Intercom inbox poller",
        desc: "Catch-all poller that searches Intercom's enterprise inbox for conversations missed by webhooks. Runs every 5 minutes via pg_cron and on-demand from settings.",
        icon: Ticket,
        edgeFunction: "poll-intercom-inbox",
        details: [
          "Scheduled: runs every 5 minutes via pg_cron (*/5 * * * *) using net.http_post; also manually triggerable from settings page",
          "Gap-free: uses last_polled_intercom_at as the search lower bound — each poll picks up exactly where the last one left off (48h fallback on first run)",
          "Queries Intercom Search API with multiple strategies: 1) team_assignee_id matches enterprise inbox, 2) admin_assignee_id for each admin in admin_owner_map (excludes the bot admin / intercom_assignee_id to prevent timeout from high-volume results) — deduplicates across all queries",
          "STRICT INBOX GUARD: after fetching each conversation, skips it unless team_assignee_id currently equals the configured enterprise inbox ID — prevents over-import of conversations assigned to Sam from other inboxes",
          "Paginates through results (50 per page, capped at 10 pages / 500 results per query to prevent timeouts)",
          "Companion backfill: backfill-enterprise-inbox edge function paginates through ALL tickets ever assigned to the enterprise inbox (no time bound) for one-shot catch-up runs from settings",
          "Deduplicates against conversation_mappings, gmail_conversations, and manual_conversations",
          "Gmail cross-reference: extracts contact email and links to unlinked Gmail threads (same logic as webhook handler)",
          "Fallback: creates manual_conversations entry with full message history if no Gmail match",
          "Auto-owner: resolves admin_assignee_id via settings.admin_owner_map",
          "Updates last_polled_intercom_at in settings after each run",
        ],
        accent: "orange",
      },
    },
    {
      id: "inbox-v2-sync",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H * 2 },
      data: {
        label: "Inbox v2 sandbox sync",
        desc: "Parallel read-only mirror of Intercom into the inbox_v2_tickets table. Used to validate Owner / Product Area / Classification before any cutover from the live Inbox.",
        icon: Beaker,
        edgeFunction: "sync-inbox-v2",
        details: [
          "New table public.inbox_v2_tickets keyed by intercom_conversation_id (unique). Authenticated users read only; only the sync function (service_role) writes.",
          "Sync function pulls conversations in the enterprise inbox updated within windowHours (default 24h) and upserts subject, contact, owner, product_area, classification, status, timestamps, and raw_payload.",
          "Field sources match the live pipeline: owner ← admin_owner_map[admin_assignee_id]; product_area ← custom_attributes['Affected Product Area']; classification ← custom_attributes['Ticket type'].",
          "Unlike the live tables, this table DOES null-out values when Intercom is blank — drift is the signal we want to see.",
          "Two pg_cron jobs: sync-inbox-v2-frequent every 15 minutes (windowHours=2) and sync-inbox-v2-nightly at 03:00 UTC (windowHours=720).",
          "UI lives at /inbox-v2 (sidebar entry with Beaker icon). Read-only table with search + Owner/Product area/Classification/Status filters (each with a 'missing' option), 'Sync now' button, and a right-side drawer with 'View in Intercom' link.",
          "Zero blast radius: no existing table, function, cron, query, or page is touched. Cutover (pointing the live Inbox / /my/* at this data) is a future, gated step.",
        ],
        accent: "orange",
      },
    },
    {
      id: "inbox-v3-closed",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H * 2.6 },
      data: {
        label: "Inbox v3 — closed sync",
        desc: "Closed-anchored reporting mirror of Intercom enterprise tickets. Full GET on finalize, then frozen. Parallel to v2. Hard data floor June 1, 2026.",
        icon: Beaker,
        edgeFunction: "sync-v3-closed",
        details: [
          "Table public.intercom_tickets_v3 keyed by intercom_conversation_id. Reporting columns only (no engagement / AI). lifecycle_status ∈ open / finalized / reopened_after_finalize. Pre-computes time_to_resolve_s at finalize so KPIs don't unmarshal jsonb.",
          "sync-v3-closed (cron sync-v3-closed-frequent, every 15 min, mode=incremental): walks closed enterprise conversations with updated_at > cursor (clamped to CLEAN_DATA_START 2026-06-01). Full GET per row, writes everything, sets lifecycle_status=finalized. Existing finalized rows with newer activity are re-fetched and only flip to reopened_after_finalize when state≠closed OR statistics.count_reopens > reopen_count_at_finalize (snapshot stored at finalize). Otherwise treated as a silent nudge: silent_update_count++ and last_silent_change records the diff (CSAT/tags/custom_attributes/assignee/conversation_parts). Surfaced in the InboxV3 detail sheet.",
          "Time-boxed at 120s; cursor advances to max updated_at observed. Job state persisted in intercom_sync_jobs_v3(kind=closed_backfill).",
          "Backfill mode used by gap-scan and the Settings 'Catch up closed' button.",
        ],
        accent: "orange",
      },
    },
    {
      id: "inbox-v3-open",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H * 2.9 },
      data: {
        label: "Inbox v3 — open refresh",
        desc: "Cheap freshness pass for open enterprise tickets. Search-payload only, no per-conversation GET.",
        icon: Beaker,
        edgeFunction: "sync-v3-open",
        details: [
          "Cron sync-v3-open-frequent, every 5 min, windowHours=2.",
          "Upserts the minimum needed for the v3 inbox view: state, admin assignee, owner, subject, contact, timestamps. Never touches finalized rows; never overwrites product_area / classification / tags / csat_* — those are only trusted at close.",
        ],
        accent: "orange",
      },
    },
    {
      id: "inbox-v3-gap-scan",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H * 3.2 },
      data: {
        label: "Inbox v3 — gap scan",
        desc: "Daily safety net. Reconciles Intercom closed-count vs ours per day and auto-enqueues missing days to sync-v3-closed.",
        icon: Beaker,
        edgeFunction: "sync-v3-gap-scan",
        details: [
          "Cron sync-v3-gap-scan-nightly at 04:00 UTC, lookbackDays=30.",
          "Buckets the lookback window into UTC days (clamped to CLEAN_DATA_START), asks Intercom total_count of closed enterprise tickets per day vs our finalized count per day. For any day where we're short, self-invokes sync-v3-closed in backfill mode for that day.",
          "Catches the 'we never finished backfilling' class of bug — the failure mode that produced the 5 missing tickets in v2.",
        ],
        accent: "orange",
      },
    },
    {
      id: "changelog-page",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H * 3 },
      data: {
        label: "Changelog page",
        desc: "Self-service release notes shown at /changelog. Manually authored entries — not auto-generated from edit history.",
        icon: ScrollText,
        details: [
          "Table public.changelog_entries (id, entry_date, title, body, tags[], area, author_user_id) with RLS allowing any authenticated user to read/insert/update/delete — same trust model as Settings and Knowledge.",
          "UI lists entries reverse-chronologically grouped by month with a sticky month header; each entry has inline edit and delete controls.",
          "Add/edit dialog captures date (defaults to today), title, body (plain text with line breaks), tag multi-select (new / improved / fixed / internal), and optional area free-text.",
          "Seeded on creation with ~8 entries summarising the previous month's shipped work so the page isn't empty on first load.",
          "Sidebar entry sits at the bottom utility section under Knowledge, icon ScrollText. No edge functions, no cron, no external surface.",
        ],
        accent: "default",
      },
    },
    {
      id: "customer-resolution",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H * 3.6 },
      data: {
        label: "Customer resolution (Track A)",
        desc: "Attributes each intercom_tickets_v3 ticket to a known customer account (/customers). Intercom stays read-only — all mapping lives here.",
        icon: Users,
        details: [
          "Resolver order (first match wins): (0) tag 'enterprise-not-enterprise' → 'not_enterprise' (population gate — evaluated ABOVE override so an out-of-scope ticket is excluded even if an override was set); (0b) tag 'enterprise-prospect-personal-acct' → 'prospect_personal' (personal-email prospect gate — ABOVE override + account rules; only Rule 0 outranks it. Individual on a personal email inquiring about Enterprise; personal emails are blocked from Enterprise signup, so this contact can NEVER become an account); (1) override; (2) slack_channel (mapped, non-internal); (3) domain (v3_customer_accounts.domains, excluding lovable.dev + v3_personal_email_domains); (4) workspace_id (v3_workspace_customer_map, medium confidence); (4b) tag 'enterprise-prospect' → 'prospect_unmapped' / method 'enterprise_prospect' (soft fallback — BELOW all account rules so a converted prospect resolves to its real account/mapped workspace first and this never fires; verified 5 of 9 prospect-tagged tickets already matched an account above this rule); (5) 'unattributed'.",
          "Why prospects don't create registry rows: this is a trouble-ticket reporting tool, not a CRM. We deliberately do NOT track pre-sales history for speculative prospects — per-company history already lives upstream in Intercom (source of truth). Both prospect dispositions (prospect_personal, prospect_unmapped) are COUNTED but excluded from the SLA population and the Unattributed queue — always as explicit, visible categories, never a silent hide.",
          "LOCKSTEP: SQL public.v3_derive_customer (6 args: _contact_email, _override_key, _contact_domain, _slack_channel_id_detected, _workspace_id_detected, _tags text[]) + BEFORE trigger intercom_tickets_v3_apply_customer (passes NEW.tags) + propagate triggers on v3_customer_accounts / v3_channel_account_map / v3_internal_channels / v3_workspace_customer_map + Deno _shared/v3-customer.ts (passes _tags) + backfill_v3_customer_keys (passes each ticket's tags). Editing rules requires updating all of them.",
          "Propagation is bidirectional: mapping a channel/domain/workspace once retroactively re-attributes all existing matching tickets (propagate triggers bump updated_at, which re-fires the derive trigger) AND all future ones automatically.",
          "Signals extracted at sync-time from raw_payload by _shared/v3-signals.ts into slack_channel_id_detected / workspace_id_detected / project_uuid_detected. Slack channel id is taken ONLY from the auto-generated bot 'slack-url-*' note — human/internal notes are ignored. Runs in sync-v3-closed, sync-v3-open (finalize/reopen), _shared/v3-finalize.ts. Backfills: backfill-v3-signals, backfill-v3-ticket-attributes.",
          "Custom attributes: _shared/v3-attributes.ts flattens raw_payload.custom_attributes into intercom_tickets_v3.custom_attributes (jsonb mirror) and v3_ticket_attributes (queryable).",
          "Verified coverage: 'attributed' = resolved to a registry account. Manually-entered override keys that don't match any account are ORPHANS — surfaced for reconciliation, not counted. v3_coverage_current() returns disposition counters excluded_not_enterprise (Rule 0) + excluded_prospect_personal (Rule 0b) + excluded_prospect_unmapped (Rule 4b) and population (= total_tickets − all three excluded counters); pct_attributed is over population (in-scope tickets), NOT total_tickets. pg_cron 06:00 UTC calls v3_capture_coverage_snapshot() into v3_coverage_snapshots (matching excluded_* columns) for the trend chart.",
          "UI /customers (src/pages/Customers.tsx) — 4 tabs. Coverage: KPI shown as 'N of {population} in-scope tickets' + three disposition cards ('Non-Enterprise (excluded)', 'Individual inquiries (personal)', 'Prospects (unmapped)'), method distribution, trend. Unattributed: queue of unattributed tickets grouped via v3_unattributed_groups into domain / channel / workspace / personal_unlabeled ('Likely personal — needs label') / no_signal. Group counts + expanded rows use the SAME server RPCs (v3_unattributed_groups for counts; v3_personal_unlabeled_tickets for personal_unlabeled rows; v3_no_signal_tickets for no_signal rows) so count == rows by construction (single-source-of-truth pattern; prevents the count/rows drift bug we fixed for no_signal). Coverage stat 'Personal inquiries labeled: N of M (P%)' keeps a forgotten personal-acct label LOUD. Channels: list + auto-suggestions from v3_channel_account_proposals. Registry: CRUD + search + orphan reconciliation; accounts carry an is_test boolean (default false, currently true for let_it_fly_test_account) that flips the account's tickets into the SLA 'test_account' exclusion — see Track B / Test sandbox accounts. Rows expand to underlying tickets via v3_tickets_for_channel / v3_tickets_for_override_key with Intercom deep-links.",
          "Tag-sync-lag surfacing on Unattributed: amber banner driven by v3_unattributed_sync_status() (returns pending_open, pending_closed, next_full_fetch_at, schedule_desc) plus a per-row 'tags pending sync' badge on any expanded ticket where last_full_fetch_at IS NULL (v3_no_signal_tickets / v3_personal_unlabeled_tickets return that column). Why it matters: Intercom tags/labels only populate on a FULL fetch, written by sync-v3-closed on close/finalize — NOT by the light list-sync that ingests new tickets. OPEN tickets are therefore TAG-BLIND until they close: tag-driven dispositions (enterprise-not-enterprise, enterprise-prospect-personal-acct, enterprise-prospect) are invisible while open, so a tagged-but-open ticket can look like settled 'unattributed' when its disposition is really unknown-until-close. The banner splits open vs closed on purpose — the */15-min sync-v3-closed-frequent cadence only re-fetches CLOSED tickets, so the 'next full fetch ~HH:MM UTC' clock is only meaningful for the closed line; the open line explicitly says labels pull when the ticket closes (no clock). SLA reporting is unaffected (population = finalized tickets), but the queue must not present tag-blind rows as settled — hence the loud surfacing.",
          "Permissions: per-ticket override (customer_override_key) is open to any authenticated user; all structural registry writes (accounts, channel maps, internal channels, workspace seeds, proposal generation) are admin-only via has_role(auth.uid(),'admin').",
          "Key RPCs: v3_derive_customer, v3_coverage_current, v3_capture_coverage_snapshot, v3_unattributed_groups, v3_unattributed_sync_status, v3_no_signal_tickets, v3_personal_unlabeled_tickets, v3_channels_usage, v3_accounts_usage, v3_orphan_overrides, v3_orphan_override_suggestions, v3_generate_channel_proposals, v3_channel_proposals_pending, v3_tickets_for_channel, v3_tickets_for_override_key. backfill_v3_customer_keys(force,batch) re-derives in 5k batches (force=true after rule edits).",
          "Design principles: surface problems loudly (unresolved → visible queue + coverage KPI, never a silent default — same principle drives the personal_unlabeled split and the two prospect KPIs); single-source-of-truth on the wire (count and rows share the same server predicate); human signals are advisory, stored attribution is system-derived (a bad manual entry can only fail to match, not corrupt data); support-reporting tool, not a CRM (no registry rows for prospects). Ticket-status taxonomy carried on the ticket via read-only Intercom tags: not-enterprise (Rule 0 → excluded), prospect_personal (Rule 0b → excluded, no registry), prospect_unmapped (Rule 4b → excluded, no registry — silently stops firing once the prospect converts to a real account), customer incl. former (plain registry account, no tag → attributed and counted).",
        ],
        accent: "default",
      },
    },
    {
      id: "sla-measurement",
      type: "flowNode",
      position: { x: COL_W * 0.6, y: ROW_H * 3.6 },
      data: {
        label: "SLA measurement & compliance (Track B)",
        desc: "Measures actual SLA shape (FRT, resolution, reopen, handling time) AND evaluates it against provisional per-severity compliance targets. All Enterprise SLA timers anchor on the Enterprise Inbox assignment (not ticket-open). Per-ticket validation tool + snapshot-based batch reporting. Strictly read-only.",
        icon: Beaker,
        details: [
          "Flow: Intercom conversation → sla-ticket-analyze (read-only GET proxy, verify_jwt=true, ≤10 ids, Intercom-Version 2.11, reuses INTERCOM_API_TOKEN) → computeSla engine → /sla-test UI. All metric logic runs client-side; the edge function is a thin proxy so Intercom stays strictly read-only and there is zero server-side duplication.",
          "Engine src/lib/slaMetrics.ts is pure, source-agnostic — same computeSla(conversation) runs on live fetches AND stored raw_payload. Actor model classifies each part as customer | human_admin | sam_ai | operator_bot | system. Sam identified by author.id='9520895' or email 'lovable@parahelp.com' — NOT by Intercom's from_ai_agent / is_ai_answer flags (all FALSE for Sam via Parahelp). Teammates identified by @lovable.dev email domain — recovers Slack-mirrored replies that Intercom emits as author.type='user'.",
          "UNIFIED CLOCK-START = Enterprise Inbox assignment. slaClockStartS = ts of the first team-assignment to ENTERPRISE_INBOX_TEAM_ID='8484447' (Intercom team id for the Enterprise Inbox), else created_at. Both First Response AND Resolution are measured from this anchor — everything before it (intake/routing, Sam's AI handling, pre-ticket Slack chatter) is PRE-ENTERPRISE and NOT counted. Three families, one rule: (a) email/direct → anchor ≈ creation; (b) Sam-first → anchor = Sam→human handoff, Sam's window excluded; (c) Slack-native → anchor = ticketization, pre-ticket Slack excluded. This REPLACES the previous 'FRT from AI→human handoff (escalation) else from open' branching — firstHumanReplyFromEscalation*, firstHumanReplyFromOpen*, escalationBasis and escalationTs remain on SlaResult for the live-Analyze display strip and back-compat only, NOT used by evaluateCompliance.",
          "First Response (compliance) = SUPPORT-based, clamped (commit 1752ca6): firstSupportReplyFromInboxS / firstSupportReplyFromInboxBusinessHoursS — A = ts of the first PUBLIC reply anywhere in the thread by a teammate on the SUPPORT roster (public.teammates WHERE role='support'), matched by EMAIL **or** intercom_admin_id; B = slaClockStartS (Enterprise Inbox anchor); FRT = max(0, A − B). Sam (role='ai') is never on the roster → correctly excluded. No support reply at all → null (not-evaluable). Why email OR id: a support engineer's Slack reply mirrors into Intercom carrying only the email (no admin id), while in-Intercom replies carry the admin id — matching on both catches every real first response. Why clamped: support who answers BEFORE the ticket reaches the inbox used to produce a false breach; max(0, …) makes 'answered before the ticket existed' a MET at 0. The roster is passed IN from useSlaBatch (which loads teammates role='support' into supportEmails/supportAdminIds and calls computeSla(payload, { supportEmails, supportAdminIds })) so the engine stays pure; if the roster fails to load both sets are empty and the engine falls back to the pre-commit behavior (any human_admin public reply) rather than scoring nothing.",
          "Work-Before-Ticket (commit 9edcf7a) — workBeforeTicketS / workBeforeTicketBusinessHoursS = max(0, B − A), the exact MIRROR of the clamped FRT: how long Support was already working the issue before the ticket existed. It is a Tenet #1 ('no work without a ticket') process signal, NOT an SLA breach and never part of any %met. Distinct from pre-inbox time: pre-inbox = the CUSTOMER's total wait before the Enterprise anchor; Work-Before-Ticket = OUR documented work that predates the anchor. Surfaced on the Workbench only (Work Before Ticket card, with by-source breakdown).",
          "FR BASIS = CUSTOMER-INITIATED on ALL SLA pages (commit 91ae443). Every First-Response tally (Dashboard, Report, Workbench) counts only rows where sla.initiatedBy === 'customer'; agent-initiated tickets (we opened them — outbound / CSM relay / forwarded email) are excluded because there is no customer waiting, so 'first response' is meaningless. Resolution ALWAYS covers all in-scope tickets. This fixed a real drift where SlaReport computed FR over ALL initiations while the Dashboard used customer-initiated only, so the two surfaces disagreed on the same month.",

          "Resolution (compliance): resolutionActiveS / resolutionActiveBusinessHoursS — stop-the-clock active in-our-court walk from the anchor to last close, excluding customer-wait segments and closed-then-reopened dormant gaps (guard: closeAt < anchor → 0). Industry-standard ball-in-our-court + inbox-anchored so Sam's pre-handoff work is out. Raw ttr* preserved for reference only.",
          "A CLOSE STOPS THE RESOLUTION CLOCK (commit e729937): a part_type='close' closes the active segment if the ball is with us and sets ballWithUs=false — at close the ball has left our court; a later customer message / reopen starts a FRESH in-our-court segment. Why: previously only OUR public reply stopped the clock, so in the common 'thanks!' → we close without replying pattern the ball was left with us, and on a reopen last_close jumped forward and the whole dormant gap counted as one unbroken in-our-court segment → PHANTOM resolution breach (Experian ticket 215474664060068, Sev 3: ~340 business-hours vs a 75h target; true active time ≈ 9.5h, compliant). Retroactive — resolution is computed live over raw_payload, no backfill. STILL OPEN (deferred to open-ticket ingestion, NOT fixed by this): (a) pre-anchor-reply over-count — the loop hardcodes ballWithUs=true at the inbox anchor even when Support replied just before it; (b) late-inbox-anchor under-count — Slack-native tickets ticketed at/near close measure only a tail.",
          "Pre-inbox time (preInboxTimeS = enterpriseInboxAssignedAtS − created_at, else null): reported as a PROCESS-HEALTH signal ('work happening before a ticket exists' / Sam handling window). KPI card on the batch, explicitly NOT an SLA. Its tail currently mixes legitimate Sam-handling with true pre-ticket Slack work (a future split into 'Sam-first excluded handling' vs 'Slack-native pre-ticketization' is noted).",
          "Manually-logged bulk-import exclusion: SlaFlags.manuallyLogged = true when the source body matches /manually logged slack_thread/i (the generated signature of our own Enterprise Support Hub bulk-add). In useSlaBatch.classifySlaBatchRow this is checked BEFORE excluded/noCustomer/inScope; those rows land in a distinct 'manuallyLogged' bucket, shown with a visible count in the batch header ('Manually-logged (excluded): N'), and are excluded from all compliance. Why: no real reply timestamps (created_at = import moment, 0 comments) → unmeasurable for SLA; the visible count lets us watch volume.",
          "Population exclusions (useSlaBatch.classifySlaBatchRow, in order): manuallyLogged → excluded → noCustomer → inScope. 'excluded' fires on ANY of: rsa_override=false (explicit); rsa_override IS NULL AND tags include enterprise-fyi OR enterprise-duplicate; merged_ticket tag; customer_resolution_method IN (not_enterprise, prospect_personal, enterprise_prospect) — Rules 0/0b/4b disposition gates; OR customer_key ∈ testAccountKeys AND showTestData=false (account-level 'test_account' exclusion — see Test/sandbox accounts below). rsa_override=true overrides the tag-based exclusions.",
          "Test/sandbox accounts (v3_customer_accounts.is_test boolean, default false; currently true for let_it_fly_test_account). useSlaBatch loads testAccountKeys and accepts { showTestData }; classifySlaBatchRow short-circuits test-account rows into 'excluded' (reason test_account) unless showTestData=true, in which case they fall through into inScope like real tickets. Both SlaDashboard and SlaWorkbench render a default-OFF 'Show test data' toggle (shared TestDataToggle exported from SlaWorkbench, re-used on Dashboard) + a loud amber/destructive banner 'Test data included — these figures are NOT real compliance' whenever ON. When ON the sandbox account appears in the customer dropdown and its breach tickets flow into scorecard + breach lists. Why: gives Matt a SAFE way to demo populated breach reports without waiting on a real customer breach and without ever polluting real compliance (off-by-default, loud when on, zero contribution to real aggregates in OFF-mode). Intercom-as-truth preserved: sandbox breaches are REAL throwaway Intercom tickets deliberately left to breach (unresponded → FRT breach, unresolved → resolution breach), left UNTAGGED so is_test at the account level is the sole exclusion — exactly what the toggle lifts. For Let-it-Fly, is_test REPLACES enterprise-fyi as the exclusion mechanism (per-ticket fyi would keep rows hidden even in test mode, defeating the purpose). No engine change — slaMetrics/computeSla is untouched; the change is purely one additional population filter next to existing tag/rsa/disposition exclusions.",
          "Initiation segmentation (initiatedBy: 'customer' | 'agent' on SlaResult): classified from source.author actor. 'agent' only if source actor is human_admin/sam_ai; customer/bot/system/unknown default to 'customer' (anti-masking — never silently drop a ticket out of FR). FR compliance % defaults to customer-initiated only; agent-initiated shown separately in an always-visible Initiation: X · Y line and excluded from the FR %; toggle exposes source-independent total. Resolution ALWAYS covers all tickets. Rationale: ~half of enterprise tickets are opened by us (outbound / CSM relay / forwarded email) where 'first response' is meaningless; including them padded Sev 2 FR from 77% to 83%. Known: forwarded customer email from our shared @lovable.dev inbox misclassifies as agent — accepted; future manual override.",
          "Compliance evaluation (SLA_TARGETS + parseSeverity + evaluateCompliance in slaMetrics.ts, ComplianceSection in SlaTest.tsx): provisional per-severity targets — Sev1 FR 30m/Res 8h wall-clock 24/7 (pending Development off-hours-coverage buy-in); Sev2 FR 4h/Res 2 business-days; Sev3 FR 1 business-day/Res 5 business-days; Sev4 FR 3 business-days/Res best-effort. Severity read from raw_payload.custom_attributes.Severity; parseSeverity returns null for missing/unknown and is NEVER defaulted — missing goes to a visible 'Unclassified' bucket (surface-errors-loudly). SLA_TARGETS is the single source of truth. FR reads firstSupportReplyFromInbox* only (SUPPORT-roster, clamped); Resolution reads resolutionActive* only.",
          "Business hours: Europe/Berlin, DST-aware, Mon–Fri 09:00–24:00. BUSINESS_DAY_SECONDS = (END-START)×3600 = 15×3600, derived. Business-hours durations display as business days ('bd', 1 bd = 15h) via formatBusinessDuration; calendar durations display as 24h days via formatDuration. Compliance section picks the formatter per column by the target's clock.",
          "UI split into TWO pages, one data spine: shared hook src/hooks/useSlaBatch.ts loads intercom_tickets_v3 (finalized/reopened, all owners, paged 500) and runs computeSla+classifyRow per row; both pages consume it — no duplicate fetch. Shared KpiCard at src/components/sla/KpiCard.tsx. /sla-test → redirects to /sla.",
          "UI /sla (SlaDashboard.tsx) — DEFAULT landing, leadership-facing / at-a-glance. Renders ONLY: population+coverage chips → color-coded per-severity compliance scorecard (customer-initiated basis, no toggle — the honest default; FR %met and Res %met tinted by band ≥90 healthy / 75–89 warning / <75 breach, color ALWAYS with the visible % + target; small per-row destructive breach-count badge when >0; Sev 4 res = 'best-effort') → 'How these are measured' popover. DELIBERATELY EXCLUDES engine/Legacy toggle, Analyze-by-ID, per-ticket table, timing KPI tiles, by-source breakout, surfaced breach lists — why: severity-blind aggregate medians don't map to any single target and would mislead next to the per-severity scorecard; they live on the Workbench. Breach counts appear here as light per-severity badges; full breach lists live on the Workbench.",
          "THREE SLA pages, one data spine — division of labour (commit f3bb52f reorg): /sla (SlaDashboard) = live OPS view, rolling window, at-a-glance per-severity scorecard, links out to the Workbench to investigate or override. /sla-report (SlaReport) = the FORMAL MONTHLY report on a calendar month, lean leadership layout. /sla-workbench (SlaWorkbench) = practitioner detail. TECH DEBT (known, flagged deliberately): the rollup/stats logic is COPIED per page (each page has its own computeStats/scorecard code over the same hook) and Dashboard vs Report overlap heavily — a shared rollup module is the obvious next refactor; until then any counting-rule change must be applied to all three pages in lockstep (the FR-basis drift fixed in 91ae443 is exactly what this duplication causes).",
          "UI /sla-workbench (SlaWorkbench.tsx) — practitioner detail / data-behind-it. Tab 1 'Analyze by ID (live)': paste ≤10 ids → sla-ticket-analyze → per-ticket card with headline strip (our Support FRT calendar+BH vs Intercom time_to_admin_reply + Δ + Intercom SLA status), color-coded timeline, calendar|BH metric table, origin+flag badges, prominent internal/no-customer warning. Tab 2 'Batch (stored)': snapshot-based (~287 rows, not live). ComplianceSection at TOP with per-severity columns N, FR target, FR %met, FR breaches, FR n/a, Res target, Res %met, Res breaches. Filters: frBasis (customer-initiated ↔ all, FR only), date window, customer. PER-TICKET breach lists for FR and Resolution with Intercom deep-links plus the excuse / remove actions writing sla_breach_overrides (this is the ONLY place overrides are made — Dashboard and Report just consume them). Excused rows in both breach tables render the override REASON and the free-text NOTE inline beneath the 'Excused · {reason}' chip (muted italic, quoted, truncated with the full note in a title tooltip) — commit daebf72, UI-only in ExcuseCell. WHY: notes were captured in sla_breach_overrides.note but were previously only exposed as a native title= hover, invisible on touch and with no affordance ('captured but invisible' gap). SCOPE: Workbench only — the Dashboard intentionally stays aggregate (excused COUNT only). 'Work Before Ticket' card (max(0, B − A) stats + by-source breakdown). 'Excluded from population — by reason' card (the 8-reason breakdown: not_enterprise, fyi+duplicate, merged_ticket, rsa_override=false, test_account, prospect_personal, enterprise_prospect, manually-logged). BY-SOURCE breakout (Slack · Sam-first · Direct + greyed Manually-logged): n · FR %met · Res %met · Pre-inbox median — why: the aggregate hid three very different populations (Sam-first strongest, Slack weakest with large pre-inbox lag; Sam first-lines EMAIL/MESSENGER only — 0 public Sam replies on Slack-sourced tickets). KPI tiles: Support FR bh + calendar (inbox-anchored), first response any-agent, TTR bh, Pre-inbox time (labelled 'process signal, not an SLA'). Full sortable per-ticket table + shared 'Show test data' toggle.",
          "UI /sla-report (SlaReport.tsx, nav 'SLA Report', protected, read-only) — the FORMAL MONTHLY SLA Report and a DATA-BACKED TARGET PROPOSAL, not a compliance scorecard. Reuses useSlaBatch / computeSla / evaluateCompliance / aggregate / SLA_TARGETS + rowClosedAtMs — no engine, hook or resolver changes. Why framed as a proposal: SLA_TARGETS is explicitly PROVISIONAL, so every '% met' is labelled 'vs PROPOSED target' under a top banner ('Proposed SLA targets — performance baseline for calibration, not committed-SLA compliance') and the Median/p90 distributions in §3 are the headline evidence for where targets should be set. Population = the hook's inScope (all Enterprise finalized/reopened), NO owner filter; month selector (last 12, default current calendar month), membership = finalized-in-month via rowClosedAtMs. LEAN leadership layout after the f3bb52f reorg: proposal banner → §1 Scope & Population (population count; severity reconciliation with ✓/✗ MISMATCH and a LOUD 'Unclassified severity: N' block — unscoreable rows stay IN the population, never dropped; exclusions condensed to a single count line that points at the Workbench for the by-reason breakdown) → §2 Headline (overall FR %met + Res %met with met / breach / excused / not-evaluable counts, NO median/p90/avg — those are per-severity evidence, not a rollup number) → §3a/§3b by-severity scorecard (n · Target+clock · %met · not-evaluable · Avg · Median · p90) → §4 Breach SUMMARY (unexcused FR + Res counts, override rate, link to the Workbench for per-ticket detail + excuse/remove) → §5 lean By Source (Source · n · FR %met · Res %met · Pre-inbox median) → §6 caveats / data-quality footer. Work-Before-Ticket and the per-reason exclusion table were MOVED OFF this page to the Workbench — leadership reads outcomes, practitioners read detail. COUNTING RULES: %met = met_true / (met_true + unexcused breach); excused AND not-evaluable are BOTH excluded from the denominator and shown as their own counts (different kinds of non-data-point — folding either in would silently move the headline). First Response counts CUSTOMER-INITIATED rows only (same basis as Dashboard/Workbench). Sev 4 Resolution has no committed target → 'no target (best-effort)', no %met, distribution still shown. Clock basis is per severity: Sev 1 calendar/24-7, Sev 2–4 Berlin business hours. Includes the shared 'Show test data' toggle + banner (test-account tickets excluded by default).",

          "Why it beats Intercom (mechanism): Intercom's time_to_admin_reply / SLA status miscount tickets where a teammate replied in Slack (mirrored as type='user'), inflating first-response and mis-marking SLAs 'missed'. Our @lovable.dev + Sam-by-id classification recovers the true first human/agent response. Confirmed on real tickets (Checkr ~35h+'missed' vs true ~8h; Frontlineed CSM reply dropped entirely).",
          "Caveats when reading numbers: OPEN tickets (~10%) excluded from Batch (raw_payload has no conversation_parts in snapshot) → resolution optimistically biased; company holidays not yet modeled; targets are provisional/unratified; pre-inbox time mixes Sam-handling with pre-ticket Slack work (future split).",
          "Known open items: split pre-inbox time (Sam-first vs Slack-native); no-customer/CSM own-pool treatment; stored-payload completeness for Slack; manual initiation-override to correct forwarded-email misclassification; holiday-aware business-hours; aggregate dashboard + SLA compliance slider (plumbing exists, UI wiring after target ratification).",

        ],
        accent: "default",
      },
    },
  ];
}


/* ------------------------------------------------------------------ */
/*  Edges                                                              */
/* ------------------------------------------------------------------ */
const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e2-3a", source: "2", target: "3a", label: "Add Details", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e2-3b", source: "2", target: "3b", label: "Proceed", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e2-3c", source: "2", target: "3c", label: "Cancel", style: { stroke: "rgb(34,197,94)", strokeWidth: 2 } },
  { id: "e3a-4", source: "3a", target: "4", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e3b-4", source: "3b", target: "4", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e4-5", source: "4", target: "5", animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e5-6a", source: "5", target: "6a", label: "👍 Resolved", style: { stroke: "rgb(34,197,94)", strokeWidth: 2 } },
  { id: "e5-6b", source: "5", target: "6b", label: "👎 Escalate", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e5-6c", source: "5", target: "6c", label: "Reply in thread", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e6c-5", source: "6c", target: "5", label: "🔄 AI responds again", animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 }, type: "smoothstep" },
  { id: "e6b-6bi", source: "6b", target: "6bi", label: "Slack reply", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6b-6bii", source: "6b", target: "6bii", label: "Intercom reply", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6bi-7", source: "6bi", target: "7", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6bii-7", source: "6bii", target: "7", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6bii-6bi", source: "6bii", target: "6bi", label: "🔄 User replies again", animated: true, style: { stroke: "rgb(249,115,22)", strokeWidth: 2 }, type: "smoothstep" },
  { id: "e6bi-6bii", source: "6bi", target: "6bii", label: "🔄 Agent replies again", animated: true, style: { stroke: "rgb(249,115,22)", strokeWidth: 2 }, type: "smoothstep" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
const IMAGE_WIDTH = 2400;
const IMAGE_HEIGHT = 1600;

function DownloadButton() {
  const { getNodes } = useReactFlow();
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    const viewport = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewport) return;

    setExporting(true);
    try {
      const nodes = getNodes();
      const bounds = getNodesBounds(nodes);
      const vp = getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, 0.5, 2, 0.2);

      const dataUrl = await toPng(viewport, {
        backgroundColor: "#1a1a2e",
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        style: {
          width: `${IMAGE_WIDTH}px`,
          height: `${IMAGE_HEIGHT}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      });

      const link = document.createElement("a");
      link.download = "flow-diagram.png";
      link.href = dataUrl;
      link.click();
      toast.success("Diagram exported");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, [getNodes]);

  return (
    <Button variant="secondary" size="sm" onClick={handleExport} disabled={exporting}>
      <Download className="mr-1 h-4 w-4" />
      {exporting ? "Exporting…" : "Download PNG"}
    </Button>
  );
}

const FlowDiagramInner = () => {
  const [messages, setMessages] = useState<Record<string, string>>(DEFAULT_MESSAGES);
  const [savedPositions, setSavedPositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    Promise.all([
      supabase.from("bot_messages").select("message_key, message_text"),
      supabase.from("flow_node_positions").select("id, x, y"),
    ]).then(([msgRes, posRes]) => {
      if (msgRes.data) {
        const map: Record<string, string> = { ...DEFAULT_MESSAGES };
        for (const row of msgRes.data) map[row.message_key] = row.message_text;
        setMessages(map);
      }
      if (posRes.data) {
        const posMap: Record<string, { x: number; y: number }> = {};
        for (const row of posRes.data) posMap[row.id] = { x: row.x, y: row.y };
        setSavedPositions(posMap);
      }
    });
  }, []);

  const handleSave = useCallback(async (key: string, text: string) => {
    const { error } = await supabase
      .from("bot_messages")
      .update({ message_text: text } as any)
      .eq("message_key", key);

    if (error) {
      toast.error("Failed to save message");
      return;
    }

    setMessages((prev) => ({ ...prev, [key]: text }));
    toast.success("Bot message updated — changes take effect immediately");
  }, []);

  const builtNodes = useMemo(() => {
    const nodes = buildNodes(messages, handleSave);
    return nodes.map((node) => {
      const saved = savedPositions[node.id];
      return saved ? { ...node, position: { x: saved.x, y: saved.y } } : node;
    });
  }, [messages, handleSave, savedPositions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes);

  useEffect(() => {
    setNodes(builtNodes);
  }, [builtNodes, setNodes]);

  const onNodeDragStop = useCallback(
    async (_event: React.MouseEvent, node: Node) => {
      const { x, y } = node.position;
      setSavedPositions((prev) => ({ ...prev, [node.id]: { x, y } }));
      await supabase
        .from("flow_node_positions")
        .upsert({ id: node.id, x, y, updated_at: new Date().toISOString() } as any);
    },
    []
  );

  const defaultEdgeOptions = useMemo(() => ({ type: "smoothstep" as const, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }), []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={initialEdges}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
    >
      <Background gap={20} size={1} />
      <Controls />
      <MiniMap
        nodeColor={() => "hsl(var(--primary))"}
        maskColor="hsl(var(--background) / 0.7)"
        className="!bg-card !border-border"
      />
      <Panel position="top-right">
        <DownloadButton />
      </Panel>
    </ReactFlow>
  );
};

const FlowDiagram = () => (
  <AppLayout>
    <div className="h-[calc(100vh-4rem)] w-full">
      <ReactFlowProvider>
        <FlowDiagramInner />
      </ReactFlowProvider>
    </div>
  </AppLayout>
);

export default FlowDiagram;
