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
  ClipboardList,
  ScrollText,
  Bell,
  ShieldCheck,
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
/*  "Dashboards" flyout group: per-owner entries are driven by          */
/*  public.teammates (active AND show_dashboard AND role <> 'ai'),      */
/*  toggled from the Teammates panel in Settings.                       */
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
        desc: "User requests human support. Reassigns to the enterprise inbox — stays a Conversation.",
        icon: ThumbsDown,
        edgeFunction: "slack-interactions",
        details: [
          "Atomic guard: updates status to 'escalated' only if currently active/awaiting_context — second click is a no-op",
          "Removes feedback buttons",
          "Removes 👀, adds ⏳",
          "Reassigns to enterprise team inbox",
          "Does NOT convert to an Intercom Ticket (removed 2026-09-01) — reassignment is the escalation marker; everything the Hub touches stays a Conversation",
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
          "DURABLE RELAY IDENTITY (Option B, Aug 2026) — the teammate's Intercom admin id is resolved from the LIVE public.teammates table (slack_user_id first, then email ilike, active=true only), replacing a hardcoded two-entry map that was stale (Joel's id wrong, Kristina's email wrong) and missing Tine/Matt/Eren/Tejas — every one of their Slack replies used to post under the relay admin (Sam, 9520895) and read as sam_ai to the SLA engine, so the First-Response clock never stopped. The body prefix now carries a machine-readable marker `[From: <Display Name> (<email>) via Slack]`, and computeSla prefers an exact email match from relayFrom against supportEmails before falling back to display-name matching. FAIL LOUD, NEVER DROP: if no admin id resolves, or Intercom rejects the teammate id (retry falls back to the relay admin), the reply is still delivered and the gap is upserted into public.relay_attribution_gaps (slack_user_id PK, email, name, reason, occurrences, last conversation id, resolved_at) — surfaced as the Action Center 'Slack relay identity gaps' signal. Option A's name parser stays active for historical parts written before this change.",
          "RELAY-ONLY ROSTER (csm, Aug 2026) — teammates.intercom_admin_id is nullable and role accepts 'csm'. CSMs are on the roster so the sender resolves to a known person (no identity gap; gap reason is now not_on_roster and fires only for senders matching no active roster row). Their reply still relays under the fallback relay admin, and because the SLA First-Response roster is role='support' only, a CSM reply never stops the First-Response clock.",

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
          "Author-type guard (Aug 2026): if the last forwardable part is authored by user/lead/contact, the webhook skips the Slack relay entirely. Slack→Intercom forwards of the original requester's own words post as user-type parts and re-fire conversation.user.replied — without this guard the customer's message was echoed back into the thread under the Ask Lovable identity (parroting bug). Side effect: customer email replies on Slack-mapped conversations no longer surface in the Slack thread.",
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
        label: "Inbox v2 sandbox — RETIRED (2 Sep 2026)",
        desc: "Fully removed. The v2 parallel mirror (inbox_v2_tickets) was the validation sandbox that preceded Inbox v3; v3 is now the reporting system of record, so v2 was deleted end-to-end rather than left de-nav'd.",
        icon: Beaker,
        details: [
          "REMOVED CODE: edge functions sync-inbox-v2 and classify-inbox-v2-engagement (deleted from the repo and undeployed); pages src/pages/InboxV2.tsx, src/pages/AnalyticsV2.tsx and helper src/pages/inbox-v2/engagement.ts; routes /inbox-v2 and /analytics-v2 (previously de-nav'd but still reachable by URL — now 404).",
          "REMOVED CRON: sync-inbox-v2-frequent / sync-inbox-v2-nightly were unscheduled during the 2 Sep cron-credential migration; a defensive unschedule of any remaining inbox-v2 job ran with this change.",
          "HEALTH KEY CORRECTED: sync-v3-closed had been writing its heartbeat into the inbox_v2_sync bucket ('reuse v2 health bucket for now'), so the Settings row labelled 'Inbox V2 sync' was actually reporting v3 closed-sync freshness. It now writes v3_closed_sync (label 'Inbox V3 closed sync', 24h staleness window) in both integration-health.ts and integration-health-alert; the inbox_v2_sync row was deleted from integration_health.",
          "DATA: public.inbox_v2_tickets (844 rows, ~9.4 MB after compaction) is dropped separately from the SQL editor — the migration tool refuses destructive DDL because it would break a deployed app still reading the table. Nothing in the shipped code reads it as of this change.",
          "WHY FULL REMOVAL, not freeze: v2 carried no reporting value once v3 finalization + the active-clock engine landed, and a still-syncing shadow table was a source of misleading health labels and write load.",
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
        desc: "Cheap freshness pass for open enterprise tickets. Search-payload only, plus a delta-gated single GET when the ticket actually changed.",
        icon: Beaker,
        edgeFunction: "sync-v3-open",
        details: [
          "Cron sync-v3-open-frequent, every 5 min, windowHours=2.",
          "Upserts the minimum needed for the v3 inbox view: state, admin assignee, owner, subject, contact, timestamps. Never touches finalized rows; never overwrites product_area / classification / csat_* — those are only trusted at close.",
          "Delta-gated attribute refresh (Phase 1 Batch 1): open tickets used to carry STALE or NULL custom_attributes because the open path never called syncTicketAttributes — Severity, which drives the SLA target, was only refreshed at close. Verified failure: a ticket read Sev 4 in our store while Intercom said Sev 1, so it was judged against the wrong target.",
          "Fix: needFull = new to us OR changed since our last FULL fetch. The delta compares live updated_at against last_full_fetch_at — deliberately NOT intercom_updated_at, which the minimal path advances and would therefore suppress refreshes forever. When needFull, a single GET /conversations/{id} refreshes raw_payload, custom_attributes (syncTicketAttributes → jsonb mirror + EAV table), writeV3Signals, and last_full_fetch_at. Unchanged tickets stay on the cheap no-GET minimal upsert. A ticket found closed/resolved at GET time is routed to finalizeConversation. Response carries an attr_refreshed counter.",
          "tags ARE refreshed on the open full-fetch (commit 4918a70) — correcting the earlier close-only wording. WHY: tags carry the dispositions (enterprise-prospect, personal, fyi, …) that the customer-resolver trigger intercom_tickets_v3_apply_customer reads via NEW.tags. Writing tags on the open upsert fires that trigger, so a dispositioned OPEN ticket is classified/excluded in near-real-time — e.g. an enterprise-prospect ticket resolves to prospect_unmapped and drops out of the Customers 'unattributed' queue instead of sitting there until close. product_area / classification / csat stay close-only.",
          "Still poll-based only: Batch 2 (webhook triggering the same per-ticket full fetch in real time) is NOT implemented. Severity-change HISTORY tracking IS now possible — the Intercom-Version was bumped 2.11 → 2.13 in _shared/v3.ts intercomHeaders (covers sync-v3-open / sync-v3-closed / reconcile-v3-open), because 2.13 is the MINIMUM version that returns event_details on conversation parts (2.10–2.12 return none). Regression-checked as additive-only vs 2.11 — no field our sync reads was dropped. 2.13 gives event_details.value.name (the to-value) but NOT value.previous, so the previous value is derived by chronological ordering. 'Unstable' deliberately NOT used — un-pinned.",
          "New-ticket Slack alert (2026-08-12): when the upsert INSERTS a row (new to our store) AND intercom_created_at is within 24 h, _shared/new-ticket-alert.ts posts one message to Slack channel C0BPDU4JH71 (#enterprise-support-tickets, overridable via env NEW_TICKET_ALERT_CHANNEL) using SLACK_BOT_TOKEN. Dedup is the PRIMARY KEY on public.new_ticket_alerts (intercom_conversation_id) — the claim insert runs BEFORE the post, so a PK collision means 'already announced' and we skip; a Slack failure deletes the claim so a later run retries. The 24 h age gate exists so the daily windowHours=720 wide sweeps can't spam the channel with historical tickets. One alert per ticket, no breach re-nudge. Response carries an alerted counter. Requires the bot to be invited to the channel.",
          "Float coverage (12 Aug 2026): who gets @-mentioned is schedule-driven, not hardcoded. public.float_coverage_shifts holds slack_user_id + inclusive date range + start/end time + IANA time_zone + active; matching runs in two byte-identical copies (src/lib/floatCoverage.ts, unit-tested; supabase/functions/_shared/float-coverage.ts for Deno) so the /float-coverage page preview and the real ping can never disagree — edit both or neither. Local time comes from Intl (DST-aware, not a stored offset); windows are start-inclusive/end-exclusive; end_time < start_time crosses midnight and its tail matches the previous local date. Overlaps intentionally ping everyone covering. Mentions = shifts covering now UNION settings.new_ticket_alert_mentions (always-on escape hatch); env NEW_TICKET_ALERT_MENTION overrides both for tests. Nobody on shift = alert posts with NO mention (deliberate: no 2 AM page). A failed shift/settings read degrades to fewer mentions, never a dropped alert. teammates.slack_user_id feeds the shift editor's person picker.",

        ],


        accent: "orange",
      },
    },
    {
      id: "esh-write-action",
      type: "flowNode",
      position: { x: COL_W * 0.5, y: ROW_H * 2.9 },
      data: {
        label: "ESH write spine (Step 1)",
        desc: "The single choke point for Hub-originated writes to a ticket. Shipped closed: kill switch off, allowlist empty, no surface wired to it yet.",
        icon: ClipboardList,
        edgeFunction: "esh-write-action",
        details: [
          "Write-through contract: authenticate caller → resolve to public.teammates → check kill switch + allowlist → call Intercom AS that teammate's intercom_admin_id → wait for 2xx → re-read GET /conversations/{id} → only then mirror the returned values into intercom_tickets_v3. The Hub is NOT the source of truth for Intercom-owned fields in this step.",
          "Failure handling is deliberate: if Intercom rejects, the local row is left UNTOUCHED and the provider status + body are returned verbatim — we never record a value Intercom refused. If the write lands but the re-read or the local mirror update fails, the caller is told explicitly and the next sync reconciles.",
          "Attribution uses the teammate's real intercom_admin_id, never a generic bot admin, so classifyActor in the SLA engine keeps reading these as human_admin and the measurement track stays honest. All five active support teammates already carry an intercom_admin_id (verified 14 Aug), so Step 0 needed no data work.",
          "Two interlocks, both default-closed: settings.esh_write_enabled (global kill switch, false — flip it off to stop every Hub write instantly, no deploy) and settings.esh_write_allowed_actions (text[], empty). An action must be listed AND the switch on. Both refusals return 403 {blocked:true} and are LOGGED — a blocked call is a recorded event, not a silent no-op.",
          "Actions are a closed set in code (KNOWN_ACTIONS); an unknown name is refused by name, not by shape. Step 1 registers exactly one: set_severity (custom_attributes.Severity, values 1–4), not callable until allowlisted.",
          "public.esh_ticket_actions — append-only audit, one row per ATTEMPT whatever the outcome (succeeded | blocked | failed): conversation, action, actor (user id, email, teammate name, intercom admin id), payload, intercom_status, intercom_response, error. Authenticated read, service_role write, NO update/delete policies — the trail cannot be rewritten or trimmed from the app. This log is the evidence base for judging whether a write surface is safe to widen.",
          "Not in this step: no UI writes anywhere. /triage's severity control (Step 2) is the first surface and lands only after this spine is exercised, including the NEGATIVE case (kill switch off ⇒ blocked and logged).",
        ],
        accent: "blue",
      },
    },
    {
      id: "deep-search",
      type: "flowNode",
      position: { x: COL_W * 2.5, y: ROW_H * 2.9 },
      data: {
        label: "Deep search (/search)",
        desc: "Hub-wide free-text search over everything the Hub knows: ticket message bodies, custom attributes (Linear / Escalated Issue), notes, escalations, backlog, the customer registry and severity rationales. Read-only \u2014 it is a derived index, never a source of truth.",
        icon: ClipboardList,
        details: [
          "Index: public.esh_search_index (kind, ref_id, title, body, idents, meta, url_path, source_updated_at) with a generated tsvector (title/idents weight A, body weight B), a GIN tsv index and trigram GIN indexes on title + idents. Authenticated read-only; nothing writes to it except the refresh function.",
          "Refresh: esh_refresh_search_index(p_kinds text[]) rebuilds per kind (delete + insert), stripping HTML from raw_payload->source->body and every conversation_parts body via esh_strip_html. Scheduled hourly at :07 (pg_cron job esh_refresh_search_index_hourly) with a 'Reindex now' button on the page. Deliberate cadence: the searched population is overwhelmingly older tickets, so up to one hour of staleness is acceptable and cheaper than a polling job.",
          "Query: esh_deep_search(p_q, p_kinds, p_limit) unions websearch_to_tsquery full-text hits with an ident/title path (ILIKE + pg_trgm similarity) so an identifier like SCA-3522, an Intercom ID, an email or a Slack channel ID matches even when it is not a lexeme. Results carry a ts_headline snippet, the match mode (text vs id/name) and a url_path.",
          "Result links seed the destination page's existing search box via ?q= (useInitialQ) \u2014 Inbox v3, Dev escalations and Backlog \u2014 rather than adding new deep-link routes; v3 hits also expose the Intercom conversation link.",
          "Verified 31 Aug 2026: 997 rows indexed (629 v3 tickets, 253 customers, 43 backlog, 42 escalations, 25 notes, 5 severity proposals); 'SCA-3522' returns the escalation and its Intercom ticket #215475673305527 from the message body. UNVERIFIED: behaviour of the hourly cron in production and result quality on multi-word phrase queries at scale.",
        ],
        accent: "blue",
      },
    },
    {
      id: "subject-override",
      type: "flowNode",
      position: { x: COL_W * 1.5, y: ROW_H * 2.9 },
      data: {
        label: "Subject override (Hub-only label)",
        desc: "Intercom titles like \"Intercom #2154748...\" carry no meaning. The Hub can hold its own descriptive label. Display only — nothing is written to Intercom, and no SLA/triage measurement changes.",
        icon: ClipboardList,
        details: [
          "Storage: intercom_tickets_v3.subject_override plus subject_override_by / subject_override_at. Intercom's own subject column is never touched, so a label can always be reverted. _shared/v3-finalize.ts writes only subject, so re-sync and finalize cannot clobber an override.",
          "One display rule, in src/lib/subjectDisplay.ts: displaySubject(row) = subject_override → subject → \"Untitled\". Read by Triage, Inbox v3, Prospects, Dev escalations, SLA workbench (both violation tables + ticket header) and the Customer report. Search indexes BOTH the label and the original, so a ticket stays findable either way, and overridden rows show an 'edited · Intercom: <original>' subline — the label never hides what Intercom says.",
          "Editing: inline pencil on the Subject cell of every v3 table (editors only) with a Clear action, plus a Subject field in TicketFieldsPanel kept visually separate from the Intercom-mirrored fields. This write does NOT go through esh-write-action — it is Hub-local by design, gated by the existing 'Editors update intercom_tickets_v3' policy (can_edit(auth.uid())); read-only roles get 'Update refused — editor role required.'",
          "Audit: every set and clear appends subject_override_set / subject_override_cleared to conversation_audit_logs with old + new values and the acting email.",
          "Verified 24 Aug 2026 on Intercom #215474865211089: label rendered with the Intercom subline, then edited and cleared through the UI, both actions logged to conversation_audit_logs and the row falling back to Intercom's subject. UNVERIFIED: the read-only refusal path.",
        ],
        accent: "blue",
      },
    },
    {
      id: "severity-ai-proposal",
      type: "flowNode",
      position: { x: COL_W * 0.5, y: ROW_H * 2.6 },
      data: {
        label: "AI severity proposal",
        desc: "propose-severity scores a ticket 1–4 against a versioned rubric. Proposal only — it never writes to Intercom; a human clicks Accept and the write goes through esh-write-action like any other.",
        icon: ClipboardList,
        details: [
          "Edge function propose-severity (google/gemini-3-flash-preview via the Lovable AI gateway). Input = the active severity_rubric_versions body + few-shot examples drawn from past human decisions + the truncated Intercom thread (triage pass ~4k chars, reclassify pass ~12k).",
          "Cost controls: max 25 tickets per call, a daily cap in settings.severity_ai_daily_call_cap (default 200), a settings.severity_ai_enabled kill switch, and a per-ticket content hash that skips the model entirely when the thread has not changed since the last proposal (verified: second identical call returned calls=0, skipped=unchanged).",
          "Every proposal is stored in severity_proposals with rationale, evidence, confidence, model, token counts and rubric_version. When a human sets severity, recordSeverityDecision stamps the open proposal accepted (same number) or overridden (different number) with the value the team actually chose.",
          "UI (19 Aug 2026): SeverityProposalCard renders in BOTH the /triage and /inbox-v3 detail sheets, and severity is editable from TicketFieldsPanel on both surfaces (Inbox v3 sends expectedCurrent=null, so a ticket that already holds a Severity in Intercom returns a 409 stale-conflict rather than overwriting it — reload and retry). Accepting still routes through esh-write-action, and recordSeverityDecision stamps the proposal accepted/overridden on both surfaces; the Triage toolbar has a capped 'Propose severity for visible' batch button. Admin calibration lives at /severity-ai — agreement rate, a proposed-vs-final matrix, the disagreement list, token cost, and the editable rubric (saving retires the current version and activates the next; past proposals keep the version that produced them).",
          "Training foundation (19 Aug 2026): recordSeverityDecision now lives inside TicketFieldsPanel and returns the decision, so an override immediately prompts for a reason code + optional note (severity_proposals.override_reason_code/_note). propose-severity stores input_excerpt (the real ticket text, 600 chars) and builds its few-shot block from those excerpts — overridden examples first, each carrying WHY it was corrected — never from its own earlier summaries.",
          "Showdown + backtest: run-severity-eval samples N tickets that already carry a human Severity in Intercom, scores them COLD (rubric only, no few-shot) and records them in severity_eval_runs/severity_eval_items, kept out of severity_proposals so a backfill never counts as live triage. Disagreements are adjudicated ai_wrong / human_wrong / both_defensible; only ai_wrong becomes training signal. backtest-severity re-scores decided proposals + ai_wrong showdown items against a rubric DRAFT so a rubric edit is measured, not guessed. Both surface on /severity-ai, alongside an override-reason roll-up (a recurring reason = a rubric gap).",
          "Verified 19 Aug 2026: run-severity-eval n=3 scored 3/3 against rubric v2 (1 agree, 2 disagreements pending adjudication). backtest-severity correctly refused with 400 'No backtestable cases yet' because no decided proposal carries an input_excerpt yet.",
          "UNVERIFIED: the kill-switch-off refusal, the unknown-ticket-id branch, and the backtest path sourced from adjudicated showdown items have not been exercised live.",
        ],
        accent: "blue",
      },
    },
    {

      id: "triage-severity-write",
      type: "flowNode",
      position: { x: COL_W * 0.5, y: ROW_H * 3.5 },
      data: {
        label: "Triage severity control (Step 2)",
        desc: "First user-visible Hub write. /triage detail sheet sets Severity through esh-write-action — never Intercom directly, never a local write to an Intercom-owned column.",
        icon: ClipboardList,
        details: [
          "SeverityWriteControl (src/components/issues/SeverityWriteControl.tsx) renders in the /triage detail sheet and calls esh-write-action with action=set_severity. Smallest possible write: one enum, on tickets that by definition hold no Severity yet, so there is nothing to overwrite.",
          "Refusals are VISIBLE — that is the point of this step. Kill switch off, action not allowlisted, caller not mapped to an active teammate with an intercom_admin_id, or an invalid severity all render inline as 'Write refused — nothing changed' with the function's own message. A genuine failure (Intercom rejected, mirror update failed, transport error) renders as 'Write failed — nothing changed'. Neither is ever a silent no-op and neither moves the local row.",
          "On success the edge function has already written Intercom, re-read the conversation, and updated intercom_tickets_v3. The page then patches its in-memory row from the value the function reports Intercom holds, so the ticket leaves the untriaged list immediately rather than waiting up to 5 min for sync-v3-open. That patch reflects a confirmed server state — it only runs after a 2xx, it is not an optimistic update.",
          "The queue definition is unchanged: untriaged = Intercom reports no Severity. Header badge moved from 'Read-only' to 'Severity writes enabled'.",
          "QUEUE MODES (24 Aug 2026): /triage serves three queues behind a segmented control kept in the URL as ?mode= — 'Needs severity' (default, unchanged: bands, band counters, row tint, propose-severity batch button and the writes badge render only here), 'Unassigned' (no admin_assignee_id in Intercom OR no mapped Hub owner; no target, no bands, a Missing column naming which half is absent) and 'Either missing'. Predicates live in src/lib/triageQueues.ts so the page and the new Action Center signal unassigned_tickets (which additionally applies the shared isSlaExcluded filter and deep-links to /triage?mode=unassigned) cannot drift. No schema change. Verified 24 Aug: 50 open tickets, 0 need severity, 0 unassigned — the non-zero path of the unassigned queue is UNVERIFIED.",

          "Verification: positive on a test-account ticket then one real ticket watched through close; negative with the kill switch off (inline refusal, no local change, esh_ticket_actions row with outcome=blocked).",
        ],
        accent: "blue",
      },
    },
    {
      id: "owner-product-area-write",
      type: "flowNode",
      position: { x: COL_W * 0.5, y: ROW_H * 4.3 },
      data: {
        label: "Owner + product area + ticket type writes (Step 3)",
        desc: "Second write surface. Owner is a real Intercom ASSIGNMENT; product area and ticket type are the 'Affected Product Area' / 'Ticket type' custom attributes. All go through esh-write-action with strict conflict checking.",
        icon: ClipboardList,
        details: [
          "UI (19 Aug 2026): TicketFieldsPanel (src/components/issues/TicketFieldsPanel.tsx) replaces the per-field write buttons in the /triage and /inbox-v3 detail sheets — severity (Triage only), owner, product area and ticket type in one panel behind a single 'Update in Intercom' button. Only CHANGED fields are sent, one esh-write-action call per field in sequence (set_severity / set_owner / set_product_area / set_classification); a failure on one field does not cancel the others and each field prints its own accepted / refused / stale result, so a partial write is never hidden. The older single-field controls (TicketFieldWriteControls.tsx, SeverityWriteControl.tsx) remain in the repo as a rollback path.",
          "STRICT CONFLICT CHECK (the difference from Step 2): unlike Severity, these fields may already hold a value and sync-v3-open can move them underneath the operator. The function GETs the conversation FIRST and compares the live value to expectedCurrent (the value the UI displayed; null means 'was empty'). A mismatch returns 409 {blocked:true, stale:true} with 'Intercom now holds X (you saw Y)' and writes nothing — the UI tells the operator to reload, not to retry.",
          "set_owner is an assignment, not a label: POST /conversations/{id}/parts with message_type=assignment, admin_id = the human doing it, assignee_id = the target teammate's intercom_admin_id resolved from public.teammates (active + mapped, otherwise refused). The Hub never records an owner Intercom cannot hold.",
          "set_product_area is PUT /conversations/{id} custom_attributes['Affected Product Area'] — the exact key _shared/v3.ts extractFields reads, so the next sync agrees instead of reverting.",
          "set_classification is PUT /conversations/{id} custom_attributes['Ticket type'] — mirrored into intercom_tickets_v3.classification.",
          "VALUE VALIDATION (Phase 2 cutover, 18 Aug 2026): the accepted values for BOTH list fields come from public.intercom_field_options, the daily cache of Intercom's own Data Attributes API. Nothing is pinned in code and nothing falls back to settings.product_areas. Empty cache ⇒ the write is REFUSED (400) rather than validated against a stale guess, and the same cache populates the dropdowns so the UI can never offer a value the function would reject.",
          "Mirror is read off the verification GET only: product_area, classification, admin_assignee_id, and owner (via settings.admin_owner_map, the same derivation sync-v3-closed uses). Intercom reports 0 for unassigned and that is stored as NULL.",
          "All three actions are in KNOWN_ACTIONS and were added to settings.esh_write_allowed_actions on 2026-08-18; the kill switch and default-closed allowlist are unchanged.",
        ],
        accent: "blue",
      },
    },
    {
      id: "intercom-field-options",
      type: "flowNode",
      position: { x: COL_W * 0.5, y: ROW_H * 4.7 },
      data: {
        label: "Intercom field options mirror",
        desc: "Daily cache of Intercom's OWN dropdown options for 'Affected Product Area' and 'Ticket type'. The Hub validates writes against this, never against a hand-maintained list.",
        icon: ClipboardList,
        edgeFunction: "sync-intercom-fields",
        details: [
          "Cron sync-intercom-fields-daily at 05:20 UTC. Reads GET /data_attributes?model=conversation, keeps the two list attributes, upserts each option into public.intercom_field_options (attr_key, option_value, sort_order, active, first_seen_at, last_seen_at).",
          "Options that disappear from Intercom are marked active=false, never deleted — a value already sitting on historical tickets stays explainable.",
          "esh-write-action validates set_product_area / set_classification against the ACTIVE rows only. Cache empty ⇒ refuse the write; the Hub never guesses a taxonomy.",
          "Settings hosts IntercomFieldOptionsCard: Ticket type is shown as Intercom-sourced (no drift comparison, the cache IS the list); Affected Product Area is also compared against the legacy settings.product_areas list that older non-write surfaces still read, so that drift stays visible instead of silently diverging.",
          "Action center signal intercom_field_drift fires on that Product Area gap and links to /settings. Sync health is registered in integration_health, so a stale/failing cache alerts like any other pipeline.",
        ],
        accent: "blue",
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
      id: "inbox-v3-reconcile",
      type: "flowNode",
      position: { x: COL_W * -0.6, y: ROW_H * 3.45 },
      data: {
        label: "Inbox v3 — transferred-out reconciliation",
        desc: "Hourly truth-set diff that catches tickets which LEFT the Enterprise Inbox and marks them transferred_out instead of leaving them phantom-open.",
        icon: Beaker,
        edgeFunction: "reconcile-v3-open",
        details: [
          "PROBLEM (phantom-open): a ticket reassigned to another team — and often resolved there — used to linger in v3 forever as state=open with stale attributes and null severity. sync-v3-open searches by team_assignee_id = enterprise inbox, so a ticket that left the inbox is never seen again and never re-checked. Those phantoms polluted the Active queue and the Customers unattributed queue and would false-alarm a staleness/triage alert. Bounded at ~6–7 tickets.",
          "Cron reconcile-v3-open-hourly at 7 * * * *. Step 1: paginated Intercom search for ALL conversations with team_assignee_id = enterprise inbox AND state ∈ {open, snoozed} — deliberately NO time window, this is the authoritative truth set, not a delta. Step 2: diff against our rows with lifecycle_status IN (open, reopened_after_finalize) → 'departed'. Step 3: each departed ticket gets its own GET /conversations/{id} (authoritative re-check): team ≠ inbox ⇒ transferred_out (+ transferred_at, reassigned_team_id); closed/resolved in our inbox ⇒ finalizeConversation catch-up; still ours + open ⇒ left alone (still_open_edge).",
          "Transfer takes precedence over close, DELIBERATELY: if a ticket both moved teams and closed, the close belongs to the other team and must not count as our resolution. Known consequence — a transferred-then-closed ticket never gets finalized in v3.",
          "SAFETY: if the truth-set search errors the run aborts with 502 and writes NOTHING; and because every mark is backed by a per-ticket GET, even a partially-paginated truth set can't cause a mis-mark. One pass both cleans existing phantoms and prevents new ones.",
          "Lifecycle state transferred_out is auto-EXCLUDED from SLA with no extra filtering, because useSlaBatch only loads finalized / reopened_after_finalize — a ticket another team resolved is not our resolution to own. Kept visible, out of our numbers. AnalyticsV3 active/open counts explicitly exclude transferred_out. Surface: InboxV3 'Team Reassignment' tab (count badge; expandable table Subject · Intercom ID · Customer · Time-in-inbox · Reassigned-to · Transferred).",
          "Team NAMES, not ids (31 Aug 2026): the Reassigned-to column used to render the raw reassigned_team_id. public.intercom_teams caches (team_id, name, active, first/last_seen_at) — same cached-mirror pattern as intercom_field_options, refreshed by the existing daily sync-intercom-fields run (05:20 UTC) off GET /teams, with vanished teams marked active=false rather than deleted. src/hooks/useIntercomTeams.tsx exposes teamName(id); InboxV3 shows the name with the id as tooltip and falls back to the raw id on a cache miss — never blank, never guessed. Verified: 7723970 -> Product Experience Specialists.",
          "Observability: writes an integration_health row per run (key reconcile-v3-open, cast at the call site — not yet in the IntegrationKey union or the integration-health-alert list, so no Slack alert yet). Response returns split counters transferred_out / finalized_catchup / get_failed / update_failed / finalize_skipped / still_open_edge plus a capped samples array — the split is what turned an opaque 'skipped: 7' into a diagnosable failure.",
          "Constraint-bug footnote: the first migration's DROP CONSTRAINT IF EXISTS used a GUESSED name and missed the real pre-existing intercom_tickets_v3_lifecycle_chk, so a duplicate CHECK survived and silently rejected every transferred_out write (all 7 departed rows returned update_failed) until it was dropped in a follow-up migration. Lesson: look up a constraint's real name in pg_constraint before ALTER.",
        ],
        accent: "orange",
      },
    },
    {
      id: "action-center",
      type: "flowNode",
      position: { x: COL_W * -3.0, y: ROW_H * 3 },
      data: {
        label: "Action center",
        desc: "Read-only landing surface at /action-center answering one question: is anything in the ESH waiting on a human right now? Top nav entry (bell icon) with an aggregate badge on the rail.",
        icon: Bell,
        details: [
          "SINGLE REGISTRY: src/lib/actionSignals.ts exports ACTION_SIGNALS — one array that feeds BOTH the page and the sidebar badge, so the two can never disagree. Adding a signal is one entry (id, label, family, route, routeLabel, meaning, load()).",
          "Ten signals in four families. Queues: unattributed customers (v3_unattributed_groups), untriaged tickets (open/reopened_after_finalize with no custom_attributes.Severity — same predicate as /triage), open dev escalations (hub_state NOT IN customer_notified, wont_do). SLA risk: first response past target. Pipeline health: integration failures (integration_health last_status='error' OR consecutive_failures>0), stale v3 sync, Parahelp routing pending (state pending|failed), registry not published (notion_registry_changed_at > notion_registry_synced_at). Review items: knowledge doc approvals (pending_content NOT NULL), channel→account proposals (v3_channel_proposals_pending).",
          "First-response risk is POLICY-AWARE, not a hardcoded target: it loads sla_policy_versions + sla_policy_targets, resolves the effective policy per ticket by inbound date via resolvePolicy(), runs computeSla() with that version's business hours, and compares elapsed time on the target's own clock (business vs wall). Unclassified tickets are skipped (that is the Triage signal's job) and tickets with a first_response row in sla_breach_overrides are excluded.",
          "SHARED SLA POPULATION (24 Aug 2026): the exclusion predicate that used to live inline in classifySlaBatchRow now lives in src/lib/slaExclusions.ts (isSlaExcluded) and is called by BOTH the SLA workbench and this signal. Excluded: rsa_override=false; rsa_override null with tag enterprise-fyi or enterprise-duplicate; merged_ticket; customer_resolution_method in not_enterprise/prospect_personal/enterprise_prospect; tickets on v3_customer_accounts.is_test. Before this, a ticket tagged enterprise-duplicate alerted on the card while being absent from the workbench.",

          "PLAN-AWARE SIGNALS (1 Sep 2026): the blanket SUPPRESS_SSE filter is gone. Queue signals (untriaged, unassigned_tickets) now cover EVERY plan; SLA-risk signals (first_response_risk) stay Enterprise-only via enterpriseOnly(), because Self-serve Enterprise carries no first-response commitment. New signal sse_triage_risk (family sla, route /triage) counts SSE tickets still open with no Severity more than 1 hour after intercom_created_at — the only clock SSE carries. UNVERIFIED: 3 SSE tickets exist, the non-zero branch has not been observed.",
          "Stale-sync thresholds are per job kind against the newest 'done' row in intercom_sync_jobs_v3: open_refresh 60 min, closed_backfill 60 min, gap_scan 48 h. A kind with NO completed run is treated as infinitely stale, not as healthy.",
          "NO NEW TABLES, NO WRITES, NO CACHED COUNTERS. Every count is read live from the same source its destination page reads, so the card and the page it links to cannot drift apart.",
          "A loader that throws renders an explicit ERROR card (destructive styling, message shown, counted separately as 'unreadable') — NEVER as 0. A failed query must never look like a clear queue. Errors are excluded from attentionCount and added to the rail badge separately.",
          "v1 thresholds are deliberately absent: any count > 0 is attention. No age gates, no severity weighting, no mute/snooze — muting is the feature that makes an alert board lie, and it is not built until there is a real false-positive to mute.",
          "Refetch: same lightweight pattern as /triage — window focus + document visibilitychange, debounced 300 ms, at most one fetch per 10 s. No polling interval, no realtime subscription.",
          "Layout: signals with count > 0 (and error cards) hoist into a 'Needs attention' block at the top; everything else stays grouped by family below with a 'clear' marker. All-clear renders an explicit empty state rather than a blank page.",
          "Wiring: ActionSignalsProvider wraps the router in App.tsx so AppLayout's badge and the page share ONE fetch; useActionSignals() returns a no-op zero state outside the provider rather than throwing.",
          "VERIFICATION STATE (14 Aug 2026): all 10 signals load and read 0, cross-checked against SQL (44 open tickets, 0 untriaged, 0 escalations, 0 Parahelp pending, 0 pending docs, 0 unhealthy integrations) — the zeros are real, not an over-filtered query. The non-zero path (amber card + rail badge) has NOT yet been observed against live data because every queue is currently empty.",
          "EVIDENCE ON THE CARD (18 Aug 2026): first-response risk carries the offending intercom_conversation_ids (up to 5, plus '+N more') rendered as direct links into the Intercom inbox. Reason: the card used to link only to the SLA workbench, where finding the one flagged ticket was hard enough that a single alert could not be investigated — and no behaviour was changed to 'fix' the alert on one data point.",
          "Eleventh signal (18 Aug 2026): intercom_field_drift — active options in intercom_field_options for 'Affected Product Area' vs the legacy settings.product_areas list, links to /settings. Ticket type is NOT compared: the cache is authoritative for it.",
        ],
        accent: "default",
      },
    },
    {
      id: "auth-hardening",
      type: "flowNode",
      position: { x: COL_W * -3.0, y: ROW_H * 4.2 },
      data: {
        label: "Auth & endpoint hardening",
        desc: "Batch 1 of the security-scan triage: who can create an account, what gets rendered as HTML, and which edge functions require a real session.",
        icon: ShieldCheck,
        details: [
          "SELF-SIGNUP IS CLOSED. Public sign-up is disabled at the auth layer and the 'Create account' button is gone from /login. This matters because nearly every RLS policy is USING (true) for the authenticated role — the whole model assumes an authenticated user IS a vetted teammate, which was only true if account creation was restricted. New teammates must now be admin-provisioned. Leaked-password (HIBP) protection enabled in the same pass.",
          "XSS — gmail-oauth-callback: the error query param, the token-exchange payload, the insert error, and the connected email address are HTML-escaped before being interpolated into the returned HTML. Previously a crafted ?error=<script> link would execute in the browser of whoever opened it.",
          "XSS — ProjectKnowledge markdown renderer: renderMarkdown() now escapes raw text FIRST (escapeHtml) and applies inline `code`/**bold** formatting SECOND, via a shared inlineMd() helper used by headings, blockquotes, list items, paragraphs, and table cells; code blocks use escapeHtml directly. knowledge_documents.content is writable by any authenticated user, so unescaped rendering was a stored-XSS path into every teammate's browser.",
          "READ-FUNCTION AUTH: new shared helper supabase/functions/_shared/require-user.ts validates the Authorization bearer token via auth.getClaims and rejects anything without a `sub` claim. The anon key is itself a valid JWT but carries no sub, so anon-key-only calls are rejected too — that is the important property.",
          "Guarded (UI-only call sites, verified): search-intercom-by-email, list-slack-users, list-slack-channels, fetch-thread-messages, fetch-gmail-thread, intercom-month-stats, check-bot-identity.",
          "DELIBERATELY NOT GUARDED YET: the ~32 mutation/sync/backfill functions. pg_cron invokes them with only the anon key as bearer, so dropping requireUser() on them would silently 401 every scheduled job (poll-gmail, poll-intercom-inbox, sync-v3-*, reconcile-v3-open, promote-pending-intercom-links, refresh-intercom-csat, sync-parahelp-routing, integration-health-alert, context-reminder, backfill-intercom-replies, poll-slack-closed-won). They need a two-path guard (user JWT OR cron secret) plus a rewrite of the cron commands — separate batch. Slack/Intercom webhook receivers stay unauthenticated by design and must be signature-verified instead.",
          "VERIFICATION (14 Aug 2026): negative test — all 7 guarded endpoints return 401 with no Authorization header AND with the anon key alone. Positive test — list-slack-channels, list-slack-users, check-bot-identity all return 200 with a real user session token. gmail-oauth-callback?error=<script>alert(1)</script> renders escaped entities.",
          "POSTGREST FILTER INJECTION (28 Aug 2026): the Gmail linker built a PostgREST .or() filter string by interpolating a raw Intercom contact email, so an address containing , ( ) % \\ \" ' or whitespace could restructure the filter and match rows it should not. New shared guard supabase/functions/_shared/safe-email.ts — isFilterSafeEmail() requires a conservative local@domain.tld shape and rejects those reserved characters. Applied in intercom-webhook, poll-intercom-inbox and backfill-enterprise-inbox: an unsafe address SKIPS the email linker only, falling back to the existing subject-match and pending-intercom-link paths, so no legitimate ticket loses its link. Three older scanner findings (gmail callback XSS, knowledge markdown XSS, open self-signup) were re-checked against the code and closed as already fixed.",
          "BATCH A — DEFINER FUNCTION LOCKDOWN + SSRF GATE (2 Sep 2026, migration 0027): every SECURITY DEFINER function in `public` (27 of them, extension-owned pg_trgm functions excluded) had EXECUTE revoked from PUBLIC and `anon`, and granted explicitly to `authenticated` + `service_role`. Before this, an unauthenticated caller holding only the publishable anon key could invoke definer functions — including reporting RPCs like v3_coverage_current and esh_deep_search — and read data straight past RLS. public.esh_strip_html(text) got `search_path = public` pinned (the last mutable-search_path function we own).",
          "SSRF — sync-knowledge-pending: the function fetched a caller-supplied `sourceUrl` with no auth check, usable to probe internal/metadata endpoints and to plant fabricated pending knowledge content. It now requires either the service-role key (maintenance callers) or a signed-in editor session via requireEditor, and `sourceUrl` must be https on an explicit host allowlist (enterprise-support-hub.lovable.app, the project preview host); anything else is a 400 before any fetch happens.",
          "VERIFICATION (2 Sep 2026): negative — anon-key POST to /rest/v1/rpc/v3_coverage_current returns 401 `permission denied for function`; sync-knowledge-pending returns 401 with no header and 401 with the anon key alone (metadata-IP sourceUrl never reached). Positive — has_function_privilege confirms `authenticated` and `service_role` retained EXECUTE on the same functions, and build is clean. The editor-session-with-non-allowlisted-host 400 branch is UNVERIFIED (no minted editor session in this pass).",
          "BATCH B — GMAIL OAUTH STATE BINDING (2 Sep 2026, migration 0029): gmail-auth-url now requires an editor and mints a single-use `state` nonce into public.gmail_oauth_states (RLS on, no anon/authenticated grants); gmail-oauth-callback refuses any callback whose state is missing, unknown, already consumed, or older than 10 minutes — BEFORE the delete/replace of gmail_oauth_tokens. The Index.tsx connection indicator reads the definer RPC public.gmail_connection_status() instead of the token table. Negative cases all verified (unauthenticated, missing, unknown, consumed, expired); a real Google round-trip is UNVERIFIED.",
          "BATCH B — MUTATION-FUNCTION DUAL-CALLER GATE (2 Sep 2026, migration 0030): new shared helper supabase/functions/_shared/require-editor-or-secret.ts accepts exactly three callers — (1) header `x-esh-cron-secret` matching public.cron_auth.secret, (2) an `Authorization: Bearer <service-role key>` for internal function-to-function invokes (sync-v3-gap-scan → sync-v3-closed), (3) a signed-in editor/admin via requireEditor. Everything else is 401/403. Constant-time comparison, 5-minute in-isolate secret cache. Applied to 17 cron+UI functions; 17 UI-only functions got plain requireEditor and sla-ticket-analyze got requireUser. Webhook receivers (slack-events, slack-interactions, intercom-webhook) and gmail-oauth-callback stay outside this gate by design — signature/state verification is their protection.",
          "CRON CREDENTIAL MIGRATION (2 Sep 2026): every scheduled job previously sent the publishable anon JWT, which is indistinguishable from an anonymous internet caller. The secret is NEVER written into a job definition: public.esh_cron_headers() (SECURITY DEFINER, service-role only) returns {Content-Type, x-esh-cron-secret} and is read at fire time. All 20 remaining edge-function cron jobs were re-registered onto it; the two retired Inbox V2 jobs (sync-inbox-v2-frequent/nightly) were unscheduled rather than migrated.",
          "VERIFICATION (2 Sep 2026, cron gate): negative — anonymous POST and bogus-secret POST both 401 on 10 sampled functions. Positive — server-side net.http_post with esh_cron_headers() to promote-pending-intercom-links returned 200 {\"ok\":true,\"promoted\":0}; post-rewrite scheduled runs landed healthy (intercom_poll 17:10, reconcile-v3-open 17:07, consecutive_failures 0 across all integration_health rows) and a cron.job audit shows uses_secret=true / still_has_anon=false for all 20 jobs. UNVERIFIED: the daily-only jobs (poll-slack-closed-won, sync-parahelp-routing, publish-registry-notion, sync-intercom-fields, sync-linear-escalations) have not yet fired under the new header, and signed-in editor 'Run now' buttons on the gated functions were not re-clicked in this pass.",
        ],
        accent: "default",
      },
    },
    {
      id: "role-permissions",
      type: "flowNode",
      position: { x: COL_W * -3.0, y: ROW_H * 6.6 },
      data: {
        label: "Editor vs read-only roles",
        desc: "Deny-by-default write model: an authenticated account can READ everything it could before, but cannot CHANGE anything unless it holds `editor` (or `admin`). Added for CSMs joining the Hub.",
        icon: ShieldCheck,
        details: [
          "ROLES: app_role gained `editor`. public.can_edit(_uid) returns true for editor OR admin (security definer, like has_role). All 11 pre-existing accounts were backfilled as editor in the same migration, so nobody lost a capability they already had.",
          "RLS: the 32 write policies that were open to any authenticated user now require can_edit(auth.uid()) in USING/WITH CHECK. Read policies are unchanged — read-only accounts still see every report, inbox and customer surface.",
          "EDGE FUNCTIONS: supabase/functions/_shared/require-editor.ts guards the 9 user-invoked mutators (esh-write-action, post-reply, delete-conversation-mapping, delete-slack-message, create-intercom-from-import, import-intercom-ticket, import-slack-thread, bulk-import-intercom, bulk-import-slack). Cron/webhook functions are untouched — they authenticate with the anon key and would 401.",
          "UI GATING (never the enforcement, only the honesty layer): useCanEdit() mirrors useIsAdmin. EditorRoute wraps the pages that exist purely to change data (Triage, Dev escalations, Import, Bulk import, Test review, Backlog, Settings, Float coverage, Flow, Knowledge) and renders a 'Read-only access' card instead. Those nav children are editorOnly and hidden. ReadOnlyBanner appears on the view-and-edit surfaces (Inbox, Conversation detail, Inbox v3, Customers) so a blocked save is never the first hint. SeverityWriteControl renders a static severity line for read-only accounts rather than a control that would refuse.",
          "ADMIN UI: role controls (Grant editor / Make read-only / Grant admin / Revoke admin) live in the actions cell of the single Users table on /users (src/components/UsersCard.tsx) — the separate Roles & permissions card was merged into it 17 Aug 2026. Admin implies edit, so admins show 'editor implied' instead of an editor toggle; rows with no backend account show 'no account yet' and no role buttons. The last-admin delete trigger is unchanged.",
          "VERIFICATION (17 Aug 2026): positive path only — /users renders the editor controls, /triage and /changelog render for an editor+admin account, typecheck clean. The READ-ONLY branch (EditorRoute card, ReadOnlyBanner, RLS refusal) is UNVERIFIED — no account without `editor` exists yet.",
        ],
        accent: "default",
      },
    },
    {
      id: "hub-access-roster",
      type: "flowNode",
      position: { x: COL_W * -3.0, y: ROW_H * 5.4 },
      data: {
        label: "Hub access roster",
        desc: "Admin-managed list of who can sign in, replacing 'ask Matt to create the account'. Self-signup stays closed — the roster is the only way in.",
        icon: ShieldCheck,
        details: [
          "TABLE public.hub_members (email UNIQUE lowercased, user_id, status pending|active|blocked, note, added_by, first_seen_at, last_seen_at, provisioned_at, blocked_at, blocked_by). RLS: admins manage all rows via has_role(); a member may SELECT only their own row. BEFORE INSERT/UPDATE trigger hub_members_validate() lowercases the email and RAISES on any domain other than lovable.dev. Backfilled with the 10 existing accounts as 'active' — nothing changed for current users.",
          "EDGE FUNCTION hub-access-manage (verify_jwt = true) actions: provision (service-role createUser with a random throwaway password, email_confirm true, row -> active), block (delete the auth account, row -> blocked, user_id nulled), unblock (row -> pending; re-provision to restore). Guarded by requireUser() AND an explicit has_role(caller,'admin') check — so a signed-in non-admin cannot call it, and cron/anon cannot reach it at all.",
          "GUARDS: refuses non-lovable.dev addresses, refuses blocking the last remaining admin, refuses blocking your own account, refuses provisioning a row that is already active or blocked.",
          "SIGN-IN PATH: /login gains 'Continue as Lovable workspace member' -> signInWithLovableWorkspace() in src/integrations/lovable, which calls the managed OAuth provider 'lovable' (@lovable.dev/cloud-auth-js upgraded 1.1.1 -> 1.1.2, which is the version that added that provider) and hands the returned tokens to supabase.auth.setSession, so RLS keeps working against a real user id. Google and email/password sign-in are unchanged.",
          "WHY PROVISION IS STILL A CLICK: with self-signup disabled the auth layer rejects an unknown identity before any app code runs, so there is no hook to auto-approve a first-time workspace member. The admin click creates the account ahead of time; the workspace identity then attaches to it.",
          "UI: ONE admin-only table — src/components/UsersCard.tsx on Admin → Users (/users, nav entry adminOnly). AccessCard and RolesCard were merged into it 17 Aug 2026 and both files deleted; they were rendering the same two queries twice (hub_members + list_users_with_roles). Columns: Email · Status · Roles · Added · Provisioned · Actions, one row per person keyed by email, sorted by email. Actions cell carries both access controls (Provision, Unblock, 'Remove access' behind an AlertDialog confirm) and role controls. The page renders an 'Admin access required' card for non-admins. DRIFT IS SHOWN, NOT HIDDEN: an auth account with no roster row renders as its own `untracked` row (not just a banner line), and an active row whose account no longer exists is named in the amber drift banner.",
          "VERIFICATION (17 Aug 2026): negative — 401 with no Authorization header and with the anon key alone; refusals returned for gmail.com address, self-block, unknown roster row, duplicate provision. Positive — test row esh-access-test@lovable.dev (mine) added + provisioned through the UI at 1900px, then blocked via the function: hub_members row status=blocked/user_id null and 0 rows left in auth.users. MERGE CHECK (17 Aug 2026): /users at 1900px renders exactly one table with 11 rows, matching SQL (11 hub_members + 0 untracked accounts); a temporary pending row (zz-verify-pending@lovable.dev, mine, deleted after) rendered Provision + Remove access with role buttons replaced by 'no account yet'. STILL UNPROVEN: the `untracked` row branch (no such account exists) and the last-admin disabled tooltip (2 admins exist, and no real admin was revoked to force it).",

        ],
        accent: "default",
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
      id: "backlog-page",
      type: "flowNode",
      position: { x: COL_W * -1.8, y: ROW_H * 3 },
      data: {
        label: "Backlog (team work tracker)",
        desc: "In-app, team-facing backlog of ALL outstanding ESH work at /backlog (Tools nav flyout). First small step toward the team actually WORKING inside ESH (\"ESH work-tickets pivot\") rather than tracking ESH work elsewhere.",
        icon: ClipboardList,
        details: [
          "Table public.esh_backlog_items — title, description, category, status, priority, area, assignee (teammate email; NULL = unassigned), linked_ref (free text: ticket id / commit sha / Linear id / URL), source (provenance for seeded items), created_by, created_at, updated_at (bumped by the shared update_updated_at_column trigger).",
          "CHECK constraints reject bad values LOUDLY rather than mis-bucketing: category ∈ (bug, todo, tech_debt, feature_request, strategic); status ∈ (open, in_progress, blocked, done, wontfix); priority ∈ (high, med, low) OR NULL. Priority NULL is an EXPLICIT 'Unprioritized' state — never defaulted to a value nobody chose.",
          "Dismissals use status 'wontfix', not deletion, so nothing is silently lost. RLS: SELECT / INSERT / UPDATE open to any authenticated teammate (team-writable on purpose — adoption beats gatekeeping); DELETE admin-only via has_role(auth.uid(),'admin'), the same admin check used by the Registry and Teammates tables. The UI hides the delete control for non-admins, but RLS is the real enforcement.",
          "UI src/pages/Backlog.tsx: per-category open-count strip (counts exclude done/wontfix), filter row (category / status / priority / assignee / free-text search + a 'show done & won't fix' toggle that is OFF by default), collapsible per-category sections sorted priority → updated_at, expandable detail rows, inline status/priority/assignee edits with toasts, add/edit dialog, and an admin-gated delete with confirm. Assignee dropdown is sourced from public.teammates WHERE active AND role <> 'ai' (Sam is never an assignee).",
          "STATE: the table is currently EMPTY — the page renders its empty state. A ~38-item inventory of known outstanding work is compiled and STAGED, to be seeded later on Matt's explicit go.",
        ],
        accent: "default",
      },
    },
    {
      id: "csat-integrity",
      type: "flowNode",
      position: { x: COL_W * -1.8, y: ROW_H * 3.8 },
      data: {
        label: "CSAT integrity (rater identity + overrides)",
        desc: "Makes a raw Intercom rating trustworthy without hiding it: name WHO rated, flag internal raters, and allow an attributed, visible suppression of a documented misfire. Nothing is edited or deleted.",
        icon: ClipboardList,
        details: [
          "RATER IDENTITY: intercom_tickets_v3 gains csat_rater_contact_id / csat_rater_external_id / csat_rater_name / csat_rater_email / csat_rater_is_internal, filled by BEFORE INSERT/UPDATE trigger trg_v3_apply_csat_rater (public.v3_apply_csat_rater) from raw_payload.conversation_rating.contact. In every rated row observed the rater contact IS the ticket requester, so name/email mirror contact_name/contact_email. is_internal = email @lovable.dev OR email matches teammates.email OR external_id 'slack:<id>' matches teammates.slack_user_id. Backfill: 61 rated → 8 internal (avg 4.88) vs 53 external (avg 4.42) — the skew the feature exists to expose.",
          "OVERRIDES: public.csat_overrides — one row per ticket_id (UNIQUE), action='exclude', reason NOT NULL (>=5 chars), original_rating, created_by / created_by_email, created_at. The rating is NEVER mutated; the override sits beside it, struck through with the reason and author shown. RLS: SELECT any authenticated; INSERT/UPDATE/DELETE gated on public.can_edit(auth.uid()). Motivating case: a 1-star for closing a duplicate the customer was told about.",
          "ONE COUNTING AUTHORITY: src/lib/csat.ts — useCsatFilters (localStorage 'esh.csatFilters.v1', shared across surfaces; defaults exclude-internal ON, exclude-overridden ON), useCsatOverrides, isRatingCounted, summarizeCsat, csatExclusionNote. Every surface prints how many responses each rule removed — n never shrinks silently.",
          "SURFACES: Analytics v3 (avg CSAT + response rate + per-customer CSAT, CsatFilterMenu in the header), Trend report (monthly avg with 'n excl.'), Customer report (CSAT positive card), Inbox v3 detail sheet (rater name/email, 'Internal rater' and 'Excluded' pills, CsatOverrideDialog). Legacy Slack/Gmail CSAT paths are untouched.",
          "DEDICATED REPORT: /csat-report (src/pages/CsatReport.tsx, nav under Reports). Read-only over intercom_tickets_v3, anchored on csat_rated_at (all 61 rated rows carry it) with the standard Analytics range picker (7/14/30d, this/last month, custom, clamped to the June 1 2026 floor). KPIs: average CSAT, % positive (4-5), response rate = counted ratings / tickets finalized in the same window, and an explicit 'excluded from the average' card split internal vs overridden. Plus a 1-5 distribution bar and a full rated-ticket table (rating, subject via displaySubject, raw Intercom ID, customer, rater name/email, remark, rated date, owner, counting pills + inline CsatOverrideDialog) with customer / rating / free-text filters and CSV export. Uses the same src/lib/csat.ts authority and CsatFilterMenu — no second counting rule.",
        ],
        accent: "default",
      },
    },
    {
      id: "resolution-anatomy",
      type: "flowNode",
      position: { x: COL_W * -1.8, y: ROW_H * 4.6 },
      data: {
        label: "Resolution anatomy (/resolution-anatomy)",
        desc: "Decomposes a long ticket's wall clock into our clock / their clock / closed / silent drift, so a rising average can be explained instead of just reported. Read-only and derived on read.",
        icon: ClipboardList,
        details: [
          "WHY: Jun-Aug 2026 median resolution stayed ~4d while P90 went 11.8d -> 17.5d. The rising average is a tail, not a shift; tickets over 7 days carry ~75% of all resolution time.",
          "ENGINE: src/lib/resolutionAnatomy.ts computeAnatomy(raw_payload, {closedAtSec}) reuses extractTimeline + classifyActor + businessHoursBetween from slaMetrics.ts UNMODIFIED. customer/shared_inbox = customer side (B6 relay rule), human_admin = our side, sam_ai/operator_bot/system = NEUTRAL (an automated ack neither discharges our obligation nor returns the ball, so it opens/closes no gap). Notes and state events are not substantive. Returns longestGap + who owed it, business-hours seconds per side, reply counts, closedWithoutCustomerConfirm, timeToFirstCloseS.",
          "CLOSED BUCKET (31 Aug 2026): the walk is EVENT-DRIVEN over the full timeline, not just substantive messages. A close part stops every clock; an explicit reopen part or the next substantive message after a close restarts it. OwedBy gains 'closed', AnatomyResult gains closedS, and a single message can carry several segments (reply-wait -> closed -> post-reopen), rendered as separate labelled gaps in the timeline sheet. WHY: ticket 215474664060068 had a 4h 45m first close and then a 32d 19h gap billed to US while the ticket was shut - a debt we did not owe.",
          "RECONCILIATION: anatomyReconciles() asserts us+customer+closed+drift == wall clock; the page banners any failures and marks those splits UNVERIFIED. Nothing persisted, no existing SLA/Analytics number changed.",
          "PAGE: two-pass load (scalars for the window, then raw_payload only for tickets over the threshold, 40 at a time). Four share cards (us/customer/closed/drift), four-series median split by month, time to first close vs time to last close (headline metric is Intercom time to LAST close, so a reopen re-clocks the ticket), top-10 rollups by area/owner/customer, sortable long-runner table with a gap-by-gap timeline sheet.",
          "VERIFIED 31 Aug 2026 (3mo, >7d, n=164, 0 reconciliation failures, PRE closed-bucket): our clock 25% vs their clock 75%; median first close 9d 22h vs last close 12d 0h; 136/164 closed with no customer reply; 48 reopened. Closed bucket verified by 12 unit tests incl. a 30-day closed stretch fully attributed to closedS. UNVERIFIED: the re-rendered population shares with the closed bucket live - the 25/75 split above predates it and should be re-read before being quoted.",
          "ACTIVE CLOCK (31 Aug 2026): active = wall clock - closedS, derived on read by activeOf() in ResolutionAnatomy.tsx. Sortable Active column shows the value plus the deduction (e.g. -32d closed); an opt-in checkbox re-applies the long-runner threshold to the active clock so closed-time-inflated tickets leave the cohort and every downstream metric on the page; a summary card reports median recorded vs median active, total cohort closed time, and how many tickets are long runners SOLELY due to closed time. Off by default - wall clock stays the reported truth. No schema or engine change; Intercom time_to_resolve_s untouched. UNVERIFIED: live population numbers under the toggle.",
          "PERSISTED WHOLE-COHORT CARD (2 Sep 2026): a 'Where the time went — whole cohort' card now sits ABOVE the long-runner panel, reading the engine-v3 persisted columns (resolution_active_s / _customer_wait_s / _eng_wait_s / _closed_s / _window_s) via summarizeSplit + splitMedians from src/lib/resolutionDisplay.ts. It covers the WHOLE in-scope finalized cohort, unlike the client-side anatomy below it, which parses raw_payload per ticket and therefore only ever covered tickets over the threshold. Both panels are kept on purpose: engine v3 has an explicit engineering-wait bucket and no 'silent drift', so the two taxonomies must not be conflated or silently merged.",


        ],
        accent: "default",
      },
    },
    {
      id: "active-clock-persisted",
      type: "flowNode",
      position: { x: COL_W * -1.8, y: ROW_H * 5.1 },
      data: {
        label: "Persisted active clock (reporting headline)",
        desc: "Resolution time reported everywhere is now the time a ticket was actually open and in our court. Closed periods and waiting-on-customer time are excluded, computed once at finalize and stored on the row.",
        icon: ClipboardList,
        details: [
          "WHY: every reporting surface counted raw wall clock, so a ticket that closed in 2h and was reopened 30 days later reported ~30d. Over finalized rows since June 1 2026 the median moved from 96.67h raw to 2.25h active — the raw figure was not a slow team, it was dormant closed time.",
          "SCHEMA: intercom_tickets_v3 gains resolution_active_s, resolution_active_bh_s, resolution_closed_s, sla_clock_start_at, active_clock_computed_at, active_clock_engine_version. Written at finalize by sync-v3-closed / sync-v3-open; 592 historical finalized rows filled by the one-shot backfill-v3-active-clock function.",
          "SHARED ENGINE: supabase/functions/_shared/sla-core.ts holds the stop-the-clock walk so the edge writers and the browser engine in src/lib/slaMetrics.ts cannot drift. Intercom's own time_to_resolve_s is left untouched and kept as the raw reconciliation value.",
          "DISPLAY CONTRACT: src/lib/resolutionDisplay.ts is the single owner of the labels 'Resolution (active)' and 'Elapsed (raw)', their tooltips, and the population collector (rows with no computed value are excluded and counted as 'not computable', never treated as 0).",
          "SURFACES: Analytics v3 (active headline KPI, raw median/average in the sub-line), Trend report (active series only — raw never plotted, shown in the tooltip so a chart cannot mislead), Monthly lookback (active by default, raw kept beside it). Resolution anatomy stays the derive-on-read explainer behind the number.",
          "VERIFIED 1 Sep 2026 against SQL: Sep finalized n=21 median active 3h13m = 3.21h, raw 3d19h = 91.4h, 1 at zero active — matches Analytics v3 exactly. Trend Jun 2h27m / Jul 1h25m match 2.45h / 1.42h. Monthly lookback August median active 2h19m against 2h18m over a hand-rebuilt exclusion predicate (150 vs 154 closed). ZERO-ACTIVE ROWS ARE REAL: 19 finalized tickets have 0 active seconds because we replied instantly and the customer never returned; they are counted, not hidden. UNVERIFIED: the exact SQL replication of slaExclusions (4-ticket delta above) and 2 rows that remain not computable.",
         "THREE-WAY SPLIT (engine v2, 1 Sep 2026): customer wait is no longer a residual. resolution_customer_wait_s / _bh_s and resolution_window_s are persisted alongside active and closed, all four walked from the SAME timeline in sla-core.ts, so active + closed + customer_wait = window BY CONSTRUCTION — any drift is an engine bug, not a source mismatch. Raw (Intercom time_to_last_close) stays outside the identity as reconciliation only.",
          "VERIFIED after the forced re-backfill of all 592 finalized rows: identity violations = 0; nulls unchanged at 2 (the same not-computable rows); resolution_active_s / _bh_s / _closed_s byte-identical to their pre-backfill snapshot on all 592 rows (0 changed). Population medians: active 2.25h vs customer wait 49.97h — 2,417.7 ticket-days of customer wait against 86.8 ticket-days of closed time, which is why the residual was never a safe proxy. Display pass landed 2 Sep 2026 (see FOUR-WAY DISPLAY PASS below).",
          "FOUR-WAY SPLIT (engine v3, 1 Sep 2026): waiting on engineering is not the customer being slow. resolution_eng_wait_s / _bh_s plus eng_wait_start_at / eng_wait_end_at / eng_wait_source are carved OUT OF CUSTOMER WAIT ONLY (customerWaitSegments intersected with the escalation window), so active and closed time are never reclassified and the identity becomes active + closed + customer_wait + eng_wait = window. Window opens at the first Escalated Issue / Linear Issue attribute event whose value is a REAL Linear reference (the field also holds Slack links and free text), falling back to the dev_escalations row date then linear_created_at; closes at min(linear_completed_at, linear_canceled_at) else the ticket close. sync-linear-escalations now mirrors those Linear timestamps onto dev_escalations.",
          "VERIFIED 1 Sep 2026 on a forced re-backfill of all 592 rows (engine 1→3): identity violations = 0; resolution_active_s and _closed_s byte-identical to the pre-backfill snapshot (0 changed); 30 tickets carry 3,542.3h of engineering wait, moved out of customer wait (58,023.8h → 54,481.4h, exactly the delta). All 30 resolved via attribute_event — the dev_escalation_row and linear_created fallbacks are UNVERIFIED on live data. Negative case: of 34 finalized tickets with a Linear reference the 4 at zero are each explained (three had the attribute set after close, one had the Linear issue completed before the reference was recorded).",
          "MULTI-LINEAR ESCALATIONS (2 Sep 2026): one ticket can carry SEVERAL Linear issues, written comma / newline separated into the same free-text Escalated Issue attribute (no new Intercom field). sync-linear-escalations extracts EVERY key and mirrors each into the new dev_escalation_links table (unique per conversation+key, read-only Linear facts); dev_escalations is unchanged and still owns the Hub decision row for the FIRST key. resolveEngWaitWindows builds one window per issue (start = max of attribute event and that issue's linear_created_at, end = min of its completion/cancellation and the ticket close) and UNIONS them, so overlapping escalations never double-count and gaps fall back to customer wait. A Linear key found only in a conversation note is advisory and NOT clock-bearing.",
          "VERIFIED 2 Sep 2026: sync wrote 44 link rows over 45 distinct keys (5 not found in Linear, pre-existing); forced re-backfill 596 rows at engine v3, identity violations = 0, engineering wait unchanged at 3,542.3h / 30 tickets. Ticket 215475479744265 now holds both ENT-3478 (Done) and ENT-3798 (In Review) with eng wait correctly unchanged — ENT-3798 was created 1 Sep, after the 31 Aug close, so its window clamps to zero. UNVERIFIED: no live ticket yet has two windows that BOTH contribute, so the union arithmetic itself is untested on real data.",
          "FOUR-WAY DISPLAY PASS (2 Sep 2026, presentation only — no engine, migration or edge-function change): the persisted split finally reaches the reporting surfaces. THE RULE: resolution_active_s stays the ONLY headline; the split answers 'where did the time go', a different question from 'how long did we take', so it renders as a sub-line, tooltip or drill-down and is NEVER plotted as a series beside the headline. src/lib/resolutionDisplay.ts gains SPLIT_KEYS (active / customerWait / engWait / closed) with shared labels, tooltips and colours (eng wait = brand pink #E66FD2), rowSplit (returns null when the engine never stamped the row — a partial row is EXCLUDED, never zero-filled into active), summarizeSplit (sum-then-share, never mean-of-shares; reports noSplit rows as 'N without split' rather than dropping them), splitMedians and one shared SPLIT_FOOTNOTE. src/components/ResolutionSplitLine.tsx renders the stacked bar + share legend everywhere.",
          "DISPLAY SURFACES: Analytics v3 gets a 'Where the time went' sub-line under the resolution KPIs over the same in-range finalized population. Trend report replaces the default Recharts tooltip with ResolveTooltip (average + median active, raw median and not-computable for reconciliation, then the month's four-way split) while still drawing only the two active-clock lines. Resolution anatomy gains a WHOLE-COHORT persisted card with per-bucket medians; the legacy client-side Our/Their/Drift/Closed panel was deliberately KEPT, not replaced — the taxonomies are not interchangeable (engine v3 has an explicit engineering-wait bucket and no 'silent drift') and the client-side one only ever covered tickets over the threshold. /escalations gains an 'Eng wait' column with a 'union of N issues' note, showing an em dash below engine version 3 rather than a fabricated 0.",
          "REPORTING METRIC STANDARD (3 Sep 2026): src/lib/reportingMetrics.ts becomes the one place a report may learn what a metric MEANS. Three layers: (1) POPULATION — inReportingPopulation() drops transferred_out, applies the plan scope, hides Hub test tickets and applies the shared slaExclusions rules; a volume surface may opt out with applySlaExclusions:false but must then label the wider population. (2) RESPONSIVENESS — time to triage (first non-empty Severity attribute event) and time to first HUMAN reply (first public human_admin part; Sam, bots, notes and the enterprise-support@lovable.dev shared relay never count), both anchored at the SLA clock start with Europe/Berlin business-hour variants. Intercom's time_to_first_admin_reply_s is DEMOTED to labelled context ('First reply (any agent)') because it measures from creation and counts Sam. (3) RESOLUTION — the persisted four-way clock; raw time_to_resolve_s is wall-clock context only. METRICS is the registry (label, description, persisted column, primary vs secondary rank); metricValue() returns null and never 0, and aggregateMetric() always reports n alongside missing so a metric cannot borrow a denominator it did not earn.",
          "RESPONSIVENESS ENGINE + SCHEMA: computeResponsiveness() in _shared/sla-core.ts (RESPONSIVENESS_ENGINE_VERSION = 1). Migration 0032_v3_responsiveness_columns.sql adds triage_set_at, time_to_triage_s, time_to_triage_bh_s, first_human_reply_at, time_to_first_human_reply_s, time_to_first_human_reply_bh_s, responsiveness_computed_at, responsiveness_engine_version to intercom_tickets_v3. Written at finalize by responsivenessFields() in _shared/v3-finalize.ts; historical rows filled by the re-runnable, editor-gated backfill-v3-responsiveness function (computed entirely from stored raw_payload, triggered from the 'Backfill responsiveness' button on the Inbox v3 sync card). A payload with no usable timeline is stamped with the engine version and left NULL, never zeroed.",
          "CONFORMED SURFACES: Owner dashboard v3 was the largest outlier — it read Intercom raw time_to_resolve_s — and now shows Resolution (active) in the table with the full four-way split, the labelled raw wall clock, time to triage and first human reply in the detail pane. Monthly lookback replaces the misleading 'Median first reply' card (Intercom's any-agent number from creation, read as if it were our human response time) with median time to triage and median first human reply, each carrying its own n and missing count, keeping the any-agent number as a third card marked 'context only'; the narrative export and Slack summary carry the same three numbers. Analytics v3, Trend report, Resolution anatomy and Escalations already read the persisted clocks and are unchanged.",
          "UNVERIFIED 3 Sep 2026: the responsiveness backfill has NOT been run — every responsiveness column is still NULL, so the new Monthly lookback cards render em dashes for historical months until an editor clicks Backfill responsiveness. The old-vs-new August delta and the population reconciliation named in the plan are therefore UNVERIFIED, as is the engine itself against live data.",
          "VERIFIED 2 Sep 2026: typecheck and build clean; across all finalized rows 599 carry a full split, 2 do not, 0 identity violations (active + customer + eng + closed = window within 2s). Population shares: active 23.0%, customer wait 69.9%, engineering wait 4.4%, closed 2.7%. UNVERIFIED: the four pages were not loaded in a browser at ultrawide width in this pass.",
        ],
        accent: "default",
      },
    },
    {
      id: "monthly-lookback",
      type: "flowNode",
      position: { x: COL_W * -1.8, y: ROW_H * 5.6 },
      data: {
        label: "Monthly lookback (/monthly-lookback)",
        desc: "Read-only narrative month review for management: volume, theme mix, spikes, customer picture, quality and what shipped, with per-section commentary you write and a one-click narrative export.",
        icon: ClipboardList,
        details: [
          "COHORT: tickets CREATED in the selected month. Headline volume is every created ticket; the reporting population then removes transferred_out plus everything the shared src/lib/slaExclusions.ts predicate marks as outside Enterprise support (rsa_override=false, enterprise-fyi / -duplicate / -not-enterprise, merged_ticket, not_enterprise / prospect_personal / enterprise_prospect resolution methods, test accounts). Quality metrics run on the CLOSED subset of that population. Data floor June 1 2026.",
          "THEME MIX (1 Sep 2026): product area and ticket type are set at CLOSURE, so buildMix runs over closed tickets only, in both the current and the prior month. Counting open tickets would have produced a large fake '— not set —' bucket that only measures work in flight: for August that bucket was 42 (23%) over the created population and disappears entirely over the closed population. Spike detection (>3 points of share moved, or new with n>=3) uses the same closed denominators.",
          "SECTIONS: headline cards, theme trends (area + type tables and a paired bar chart vs prior month), spikes, customer picture (top accounts, plan mix, concentration), quality (median/P90 resolve, FRT, reopen rate, CSAT via src/lib/csat.ts integrity rules), and shipped (changelog_entries grouped by area + dev escalation state).",
          "NOTES: public.esh_lookback_notes stores one commentary row per (month, section); reads open to authenticated, writes gated by can_edit(). 'Copy as narrative' serialises every computed figure plus the saved notes into a markdown report.",
          "CLOSURE-RULE LEAKS — FOUR FIELDS (1 Sep 2026): the leak check covers ALL FOUR Intercom custom attributes the Hub owns, not just the two with dedicated columns — Severity (custom_attributes['Severity']), Affected Product Area (product_area column), Ticket type (classification column), Escalated to Engineering (custom_attributes['Escalated to Engineering']). missingFields(row) returns the exact list and the table renders it per ticket, so a leak says WHICH field is blank. Bot-written 'Product Area' / 'Type' attributes are a DIFFERENT taxonomy owned elsewhere and are deliberately NOT read or backfilled from. Sam-owned tickets are excluded from the leak list (the AI agent never sees the closure form) and counted separately as samGapCount so the exclusion is visible, never silent.",
          "ESCALATED TO ENGINEERING CUT (1 Sep 2026): stat card in 'Shipped and process' over CLOSED tickets — Yes count, share of closed, prior-month comparison, and the count still unset. Included in the narrative export. August all-plans: 32 Yes / 154 No / 11 unset of 197 finalized.",
          "PLAN SCOPE: a global All / Enterprise / SSE selector scopes every derivation on the page AND the narrative export, so an Enterprise-only review never mixes in Self-Serve Enterprise tickets. 'Copy Slack summary' emits an mrkdwn digest (key metrics with MoM arrows, top 3 areas / types / customers, up to 5 recent changelog entries) under the same scope and CSAT filters.",
          "VERIFIED 1 Sep 2026 (August, wide viewport): 242 created / 181 population / 146 closed / 35 open / 94% categorised; theme mix renders over 146 closed vs 138 in July with no '— not set —' inflation. Four-field coverage over 197 finalized: Severity 193, Affected Product Area 190, Ticket type 190, Escalated to Engineering 186. UNVERIFIED: per-section note saving and the copy-out under a read-only role; the Slack summary and plan-scope switch have not been re-verified since the four-field leak change.",
          "ACTIVE CLOCK BY DEFAULT (1 Sep 2026): the 'Load active clock' button and its raw_payload batch fetch are GONE. Quality now reads the persisted intercom_tickets_v3.resolution_active_s scalar, so the headline is 'Median resolution (active)' on every load with 'Elapsed (raw)' kept beside it for reconciliation, and the Slack summary plus the narrative export emit the active figure. The page stays scalar-only.",
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
          "UI /customers (src/pages/Customers.tsx) — 4 tabs, deep-linkable via ?tab=coverage|unattributed|channels|registry (unknown/absent value falls back to coverage). Coverage: KPI shown as 'N of {population} in-scope tickets' + three disposition cards ('Non-Enterprise (excluded)', 'Individual inquiries (personal)', 'Prospects (unmapped)'), method distribution, trend. Unattributed: queue of unattributed tickets grouped via v3_unattributed_groups into domain / channel / workspace / personal_unlabeled ('Likely personal — needs label') / no_signal. Group counts + expanded rows use the SAME server RPCs (v3_unattributed_groups for counts; v3_personal_unlabeled_tickets for personal_unlabeled rows; v3_no_signal_tickets for no_signal rows) so count == rows by construction (single-source-of-truth pattern; prevents the count/rows drift bug we fixed for no_signal). Coverage stat 'Personal inquiries labeled: N of M (P%)' keeps a forgotten personal-acct label LOUD. Channels: list + auto-suggestions from v3_channel_account_proposals. Registry: CRUD + search + orphan reconciliation; accounts carry an is_test boolean (default false, currently true for let_it_fly_test_account) that flips the account's tickets into the SLA 'test_account' exclusion — see Track B / Test sandbox accounts. Rows expand to underlying tickets via v3_tickets_for_channel / v3_tickets_for_override_key with Intercom deep-links.",
          "SINGLE EDITOR for v3_customer_accounts (7 Aug 2026): the Registry tab is now the only place accounts are created/edited. Settings used to render a second editor (CustomerAccountsCard) against the SAME table — never a mirror or a duplicate data set, just a narrower one: it exposed only account_key / label / domains / notes, so accounts created there landed with no status / tier / aliases (half-populated registry rows the resolver and Coverage tab then had to explain). Settings now shows a one-line pointer card linking to /customers?tab=registry. src/components/CustomerAccountsCard.tsx is deliberately KEPT on disk, unrendered and with no importer, as an instant rollback path (same additive/reversible pattern as the breach+triage override consolidation). No schema, RLS, resolver or data change.",
          "Tag-sync-lag surfacing on Unattributed: amber banner driven by v3_unattributed_sync_status() (returns pending_open, pending_closed, next_full_fetch_at, schedule_desc) plus a per-row 'tags pending sync' badge on any expanded ticket where last_full_fetch_at IS NULL (v3_no_signal_tickets / v3_personal_unlabeled_tickets return that column). Why it matters: Intercom tags/labels only populate on a FULL fetch, written by sync-v3-closed on close/finalize — NOT by the light list-sync that ingests new tickets. OPEN tickets are therefore TAG-BLIND until they close: tag-driven dispositions (enterprise-not-enterprise, enterprise-prospect-personal-acct, enterprise-prospect) are invisible while open, so a tagged-but-open ticket can look like settled 'unattributed' when its disposition is really unknown-until-close. The banner splits open vs closed on purpose — the */15-min sync-v3-closed-frequent cadence only re-fetches CLOSED tickets, so the 'next full fetch ~HH:MM UTC' clock is only meaningful for the closed line; the open line explicitly says labels pull when the ticket closes (no clock). SLA reporting is unaffected (population = finalized tickets), but the queue must not present tag-blind rows as settled — hence the loud surfacing.",
          "Transferred-out exclusion on the Unattributed worked-list (commit bc8ceae): every RPC feeding the tab now carries the guard lifecycle_status <> 'transferred_out' — v3_unattributed_groups(), v3_no_signal_tickets(), v3_personal_unlabeled_tickets() and v3_unattributed_sync_status() (BOTH its pending_open and pending_closed counts) — plus the domain/channel/workspace drill query in Customers.tsx (.neq('lifecycle_status','transferred_out')), so group counts still equal the expanded rows (count == rows invariant preserved). WHY: a ticket transferred OUT of the Enterprise Inbox is handed off to another team and is never re-fetched again, so its tags/customer_key are FROZEN — it can never heal via the open-ticket tag refresh and used to sit in the worked-list forever as a phantom. This is a RE-HOME, not a silent drop: it stays visible in the InboxV3 'Team Reassignment' tab. Bonus: frozen phantoms no longer inflate the amber 'pending full-fetch' banner forever. Deliberate boundary: ONLY transferred_out is excluded — open and finalized unattributed tickets stay, because a closed-but-unattributed ticket is still a fixable data-quality item (surface-loudly rule). KNOWN divergence (intentional, undecided): the Coverage tab functions (v3_coverage_current etc.) were NOT changed, so they still count transferred-out tickets as unattributed — Coverage and the worked-list can differ by that count.",
          "Registry auto-seeding: poll-slack-closed-won (daily cron 04:00 UTC) reads Slack #closed-won (C09CL5E028N) and inserts new v3_customer_accounts rows from 'Company Name:' / 'Company Domain:' lines. Lookback widened 2 → 7 days (27 Jul 2026) because dedup (domain overlap + account_key) makes a wide window idempotent and a 2-day window missed late-posted announcements. Field capture uses [ \\t]* not \\s*, so an empty 'Company Domain:' line can no longer bleed into the next line's emoji shortcode (AARP's blank domain was captured as ':page_facing_up:' from the following 'Deal Name:' line). Malformed domains (must match a registrable-domain shape) are NEVER inserted — returned in malformed[]; blank domains are returned separately in missing_domain[] with an 'add manually' note. A blank domain only fails the run while the account is absent from the registry: derived account_keys are looked up first, and already-added ones move to missing_domain_handled[] so the health card can clear (AARP added by hand with no domains, 27 Jul 2026). No silent failures: every non-dry run writes integration_health.slack_closed_won_poll (ok only with zero insert errors, zero malformed and zero missing domains; auth_error on Slack 401/403; error on gateway/API/insert/fatal), surfaced in Settings → Integration health (36h staleness = one missed daily run) and alerted to #enterprise-support-hub-alerts. Standing rule: every scheduled function must report health this way, and its key must be registered in all three lists (_shared/integration-health.ts, IntegrationHealthCard.tsx, integration-health-alert). Diagnostics: POST { lookbackDays, dryRun }.",
          "Parahelp routing queue (step 2 of the closed-won chain, 13 Aug 2026): registering the account is only half the job — mail from that domain to enterprise-support@lovable.dev must also be routed to the Enterprise inbox in Parahelp. Tracked in public.parahelp_routing_sync (one row per domain, states pending | pushed | manual_done | failed | skipped), fed by the AFTER INSERT/UPDATE trigger parahelp_enqueue_new_domains_trg on v3_customer_accounts with ON CONFLICT (domain) DO NOTHING — so poll-slack-closed-won needed NO code change and manual registry adds/backfills enqueue identically. Decoupled ON PURPOSE: the trigger is AFTER + conflict-tolerant and the worker never writes the registry, so a Parahelp outage can only leave rows pending, never block or corrupt a registry update. All 490 pre-existing registry domains were seeded as 'skipped' so the queue tracks only new arrivals. Worker: sync-parahelp-routing, pg_cron 'sync-parahelp-routing-daily' at 30 4 * * * (30 min after the poller), takes ≤50 pending/failed rows with attempts < 5, oldest first. THE API LEG IS DORMANT — no Parahelp connector exists and no endpoint is confirmed; the push only activates when BOTH PARAHELP_API_KEY and PARAHELP_ROUTING_URL secrets are set, and pushDomain()'s request shape is a placeholder to correct once Parahelp confirms it. Until then every run posts the pending-domain digest to #enterprise-support-tickets (nothing sits silently pending) and the working surface is Admin → Customers → 'Parahelp routing' tab: oldest-first open rows with age/account/state/error, admin-only 'Mark as routed' (records completed_by) and retry. Health: integration_health.parahelp_routing_sync — a dormant API leg is NOT a failure (pending is the expected steady state); only real push failures or a queue-read/fatal error mark the run unhealthy. Diagnostics: POST { dryRun, silent }.",
          "Notion domain page (step 3 — the actual Parahelp hand-off, 13 Aug 2026): Parahelp confirmed they have NO routing API — their enterprise domain list lives in the agent's memory file (base.md) and every edit goes through their human-approval queue. What their agent CAN do is read a Notion page on a schedule/page-change trigger, diff it against memory and draft the edit for approval. So publish-registry-notion mirrors the registry to a Notion page: Domain | Account | Tier table, one row per domain, sorted, preceded by a provenance line, written through the connector gateway (connector-gateway.lovable.dev/notion/v1, LOVABLE_API_KEY + NOTION_API_KEY). EXACTLY ONE exclusion: status='prospect' (unsigned, must not route). Test accounts and inactive accounts ARE published — explicit call by Matt, 13 Aug. Idempotent: the rendered row set is SHA-256 hashed against settings.notion_registry_hash, and an unchanged set means NO Notion request at all, so Parahelp's page-change trigger only fires on a real domain change ({ force: true } overrides). Full rewrite, never a partial diff — every existing child block is deleted and the table re-appended in chunks of 90 (Notion caps children at 100/request), so the page cannot drift and removals propagate. Page id lives in settings.notion_registry_page_id (id or URL, normalized to a dashed uuid — never hardcoded) alongside notion_registry_hash / _synced_at / _changed_at / _domain_count. UI: Admin → Customers → Parahelp routing → 'Notion domain page' card (domains on page, last sync, last change written, editable page id, admin-only Dry run + Sync to Notion). Health: integration_health.notion_registry_publish (36h window; Notion 401/403 → auth_error). Diagnostics: POST { dryRun, force }.",
          "Notion publish schedule (26 Aug 2026): the Notion connection is now linked, so the deliberately-deferred daily job exists — pg_cron 'publish_registry_notion_daily' at 0 5 * * * (05:00 UTC, 60 min after poll-slack-closed-won and 30 min after sync-parahelp-routing, so a same-morning new account is registered and queued before the page is rewritten). Authored by hand in the SQL editor: agent SQL is refused on cron.* internals and the managed HTTP-schedule tools are not exposed on this project, so cron jobs here are created only by a human. First attempt shipped a malformed headers literal ('{\"Content-Type\":\"application/json\",apikey\":\"...\"}' — missing opening quote) which would have failed the ::jsonb cast on every fire; caught by reading the command back through esh_cron_jobs() BEFORE the first fire, and re-scheduled. VERIFIED 27 Aug 2026: the first scheduled occurrence fired at 05:00:07 UTC, integration_health.notion_registry_publish = ok, and it was a real write not a no-op — notion_registry_changed_at equals notion_registry_synced_at (05:00:07), 504 domains rewritten. Negative case that makes pg_cron status the only honest signal — an unchanged registry writes NOTHING to Notion and only re-stamps the hash, so a healthy no-op morning is indistinguishable from a skipped run in integration_health.",
          "Scheduled-jobs visibility (26 Aug 2026): public.esh_cron_jobs() — SECURITY DEFINER, admin-gated by has_role(auth.uid(),'admin'), EXECUTE granted to authenticated only, no anon — returns jobname / schedule / active / command_summary plus last_run_at, last_status, last_message from cron.job_run_details. command_summary REDACTS Authorization and Bearer values before they leave the database (apikey values are NOT redacted — those are the publishable anon key, already in the client bundle). Surfaced by src/components/ScheduledJobsCard.tsx at the bottom of Settings: per-job badge Ran OK / Overdue / Failed / Disabled / Never run, where Overdue = no run within twice the parsed cadence (cadenceMinutes() returns null for expressions it can't reason about and then never claims overdue). READ-ONLY BY DESIGN — no create/alter/unschedule path from the app; the panel exists so a schedule that fails BEFORE its target function can write integration_health is still visible, closing the gap where a silent scheduler failure looked identical to a healthy quiet morning.",
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
        desc: "Measures actual SLA shape (FRT, resolution, reopen, handling time) AND evaluates it against provisional per-severity compliance targets. All Enterprise SLA timers anchor on the Enterprise Inbox assignment (not ticket-open). Per-ticket validation tool + snapshot-based batch reporting. Strictly read-only. PLAN TIER (28 Aug 2026): every v3 ticket carries plan_tier ('enterprise' | 'sse'), derived at ingest purely from the Intercom inbox it is assigned to (settings.intercom_inbox_id vs settings.sse_intercom_inbox_id, resolved by _shared/v3-inboxes.ts). Self-serve enterprise has NO first-response / resolution / cadence commitments and a 1h triage target; sla_policy_versions.plan partitions policy so resolvePolicy(anchor, versions, plan) can never score SSE against Enterprise targets. Triage grades each row against its own target (30m vs 60m) and the SLA Dashboard defaults to Enterprise-only with a visible SSE count. Inert until an SSE inbox id is configured. UNVERIFIED against real SSE data.",
        icon: Beaker,
        details: [
          "Flow: Intercom conversation → sla-ticket-analyze (read-only GET proxy, verify_jwt=true, ≤10 ids, Intercom-Version 2.13, reuses INTERCOM_API_TOKEN) → computeSla engine → /sla-test UI. All metric logic runs client-side; the edge function is a thin proxy so Intercom stays strictly read-only and there is zero server-side duplication.",
          "event_details capture (Intercom 2.13) + one-off backfill. The version bump lit up event_details on conversation parts, which is what Severity/attribute change history needs. New and still-active tickets pick it up naturally on the next sync, but ALREADY-FINALIZED tickets are never re-fetched — so the one-off edge function backfill-v3-event-details (kept in place, deliberately NOT cron'd) re-fetched the ~71 finalized / reopened_after_finalize tickets created on or after 2026-07-15 at 2.13, refreshing ONLY raw_payload + last_synced_at (no re-finalize, no lifecycle/reopen/customer/EAV writes). WHY the July-15 line: that is when the Triage policy started — pulling older tickets in would pollute the baseline with pre-policy data. Result: 71/71 refreshed, 70 carrying a Severity event.",
          "Severity-event parser (slaMetrics.ts): TimelinePart gained eventDetails (populated from each part's event_details, null when absent). extractSeverityEvents(timeline) selects parts with part_type='conversation_attribute_updated_by_admin' AND event_details.attribute.name='Severity', returning a ts-ascending list of { ts, to, from, authorType, authorEmail }. 'to' = event_details.value.name; 'from' uses value.previous when present and otherwise is derived chronologically (from[0]=null, from[i]=events[i-1].to) because 2.13 omits previous. Author typing reuses the existing Actor model, which already includes shared_inbox (B6).",
          "TRIAGE METRIC — MEASURE-FIRST, PROVISIONAL target (computeTriage). Time from the Enterprise-Inbox anchor (slaClockStartS) to the FIRST Severity assignment. Fields on SlaResult: firstSeverityAtS, firstSeverityValue, timeToTriageS (wall-clock), timeToTriageBusinessHoursS (Berlin business clock), severityEventCount, hasSeverityEvent. NULL / not-evaluable when there is no Severity event or no anchor — deliberately never defaulted to 0; a Severity event BEFORE the anchor clamps to 0. The only target is the PROVISIONAL 30-min business-hours TRIAGE_TARGET_S (see the triage-discipline flags below) — unratified, and the distribution remains the evidence from which it gets ratified or moved. Why it matters: triage time is SEVERITY-AGNOSTIC, which is why it (unlike a blended FRT average across severities with different clocks) legitimately supports a SINGLE GLOBAL number for leadership.",
          "Engine src/lib/slaMetrics.ts is pure, source-agnostic — same computeSla(conversation) runs on live fetches AND stored raw_payload. Actor model classifies each part as customer | human_admin | sam_ai | operator_bot | system | shared_inbox. Sam identified by author.id='9520895' or email 'lovable@parahelp.com' — NOT by Intercom's from_ai_agent / is_ai_answer flags (all FALSE for Sam via Parahelp). Teammates identified by @lovable.dev email domain — recovers Slack-mirrored replies that Intercom emits as author.type='user'.",
          "shared_inbox actor (B6 fix) — a Lovable shared RELAY mailbox (currently only enterprise-support@lovable.dev) forwards a CUSTOMER's message into the thread under an @lovable.dev address. Detected via an explicit SHARED_MAILBOX_EMAILS allowlist, checked in classifyActor AFTER the Sam check and BEFORE the @lovable.dev → human_admin rule. Bug fixed: the domain shortcut branded relayed customer messages as OUR reply — stopping the resolution clock early (flattering) and would have falsely satisfied the upcoming cadence metric. Treated customer-SIDE everywhere, never as our agent reply: returns the ball to us in computeResolutionActive; counts as customer presence in noCustomerParticipant (relay-only-customer threads are NOT flagged no-customer); opens customer-wait gaps in handling time; maps to legacy author type 'user'; initiatedBy = 'customer' for a relayed source; never matched by firstHumanReply / firstSupportReply / escalation / noHumanReply. Why: Intercom is source of truth — it types these parts as user (contact-side) and sets waiting_since on them; confirmed live on ticket 215475248028246 (AT&T), the relayed part is the customer (Anthony Spaulding), a human replied 21 min later, and our reply cleared waiting_since (ball → customer). Allowlist deliberately NOT broadened: enumerating every @lovable.dev part-author across v3 showed enterprise-support@ is the ONLY shared relay (highest ticket fan-out; type lead/user, never admin) — every other @lovable.dev author is a real teammate (CSM Slack replies mirror in as type=user), so a broader key like 'not in the teammates roster' would misclassify real people. Clean foundation for the upcoming communication-cadence metric.",
          "UNIFIED CLOCK-START = Enterprise Inbox assignment. slaClockStartS = ts of the first team-assignment to ENTERPRISE_INBOX_TEAM_ID='8484447' (Intercom team id for the Enterprise Inbox), else created_at. Both First Response AND Resolution are measured from this anchor — everything before it (intake/routing, Sam's AI handling, pre-ticket Slack chatter) is PRE-ENTERPRISE and NOT counted. Three families, one rule: (a) email/direct → anchor ≈ creation; (b) Sam-first → anchor = Sam→human handoff, Sam's window excluded; (c) Slack-native → anchor = ticketization, pre-ticket Slack excluded. This REPLACES the previous 'FRT from AI→human handoff (escalation) else from open' branching — firstHumanReplyFromEscalation*, firstHumanReplyFromOpen*, escalationBasis and escalationTs remain on SlaResult for the live-Analyze display strip and back-compat only, NOT used by evaluateCompliance.",
          "First Response (compliance) = SUPPORT-based, clamped (commit 1752ca6): firstSupportReplyFromInboxS / firstSupportReplyFromInboxBusinessHoursS — A = ts of the first PUBLIC reply anywhere in the thread by a teammate on the SUPPORT roster (public.teammates WHERE role='support'), matched by EMAIL **or** intercom_admin_id; B = slaClockStartS (Enterprise Inbox anchor); FRT = max(0, A − B). Sam (role='ai') is never on the roster → correctly excluded. No support reply at all → null (not-evaluable). Why email OR id: a support engineer's Slack reply mirrors into Intercom carrying only the email (no admin id), while in-Intercom replies carry the admin id — matching on both catches every real first response. Why clamped: support who answers BEFORE the ticket reaches the inbox used to produce a false breach; max(0, …) makes 'answered before the ticket existed' a MET at 0. Slack relay attribution (Aug 2026): a teammate replying from Slack is posted into Intercom under the relay admin (Sam, id 9520895) with a `[From: <name> via Slack]` body prefix and no teammate email/admin id, so the engine parses that prefix into TimelinePart.relayFrom and re-attributes the part to human_admin when the name is in supportSlackNames (teammate full name, first name, or email local part, min 3 chars, from teammates role='support'); an UNKNOWN relay name (the customer speaking in the shared Slack channel) is left untouched. Without this the reply read as sam_ai and the First-Response clock never stopped. The same roster is now also passed by src/lib/actionSignals.ts so the Action Center 'First response past target' signal matches the workbench. The roster is passed IN from useSlaBatch (which loads teammates role='support' into supportEmails/supportAdminIds and calls computeSla(payload, { supportEmails, supportAdminIds })) so the engine stays pure; if the roster fails to load both sets are empty and the engine falls back to the pre-commit behavior (any human_admin public reply) rather than scoring nothing.",
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
          "Report §2b 'Triage time' (SlaReport.tsx, presentational only — same month window + inScope population as the rest of the report). Evaluable set = rows with hasSeverityEvent && timeToTriageS != null. BUSINESS-HOURS IS THE HEADLINE (commit b951be7): the four headline cards (median / average / p90 / n) and the by-FINAL-severity mini-table all read the Berlin business clock (Mon–Fri 09:00–24:00); wall-clock is KEPT but demoted to a labelled secondary row reading 'expected higher until off-hours coverage exists'. WHY the flip: there is no off-hours coverage today, so wall-clock triage is inflated by overnight/weekend ARRIVALS triaged at business open — that is a staffing-model fact, not slow work, and leading with it would have mis-stated the team's responsiveness. HONEST COVERAGE LINE is mandatory: 'Triage measurable for N of M in-scope tickets' with the note that event_details capture only starts ~15 July 2026 — tickets closed before that are NOT-EVALUABLE, not fast, and the evaluable subset is never presented as the whole population. The measure-first note stays: the 30-min target is provisional and this distribution is the basis for ratifying it (the what-if slider can tune it later).",
          "TRIAGE-DISCIPLINE FLAGS (commit 05c77ea, slaMetrics.ts) — three booleans on SlaResult, computed in computeSla: triageViolation = timeToTriageBusinessHoursS > TRIAGE_TARGET_S (1800s / 30 min, PROVISIONAL, business-hours basis); not-evaluable rows (no Severity event / no anchor) are NEVER violations — absence of data is never scored as a miss. answeredBeforeClassified = the first human_admin PUBLIC reply lands before the first Severity event (Sam and shared_inbox deliberately excluded — neither is a triaging teammate). severityRecordedAtClose = the first Severity event lands within SEVERITY_AT_CLOSE_WINDOW_S (1800s / 30 min) of the close. Surfaced as the Report §2b 'Triage discipline (provisional 30-min target)' row over the evaluable set: % over target · % answered before Severity · % Severity recorded at close.",
          "KEY INSIGHT — WHY THE FLAGS EXIST: time-to-triage today measures triage DISCIPLINE, not reaction speed — is Severity set at FIRST TOUCH, or bookkept at close? Exemplar ticket 215475222535453: engaged in ~2h (Sam instant, human reply at 2h) but Severity — and the other three 'required-at-closure' canonical fields — were not set until it closed 75h later. The ticket was worked fast and recorded late, and only the discipline flags separate those two stories. So the metric exists to drive the 'set Severity at intake' policy, which is also what makes the triage number trustworthy later.",
          "OVERRIDE MODEL — ONE TABLE (consolidation 93f3fe0): public.sla_violation_overrides is the single home for every SLA/triage/cadence exception. One row per (intercom_conversation_id, metric) UNIQUE; metric CHECK = triage | first_response | resolution | cadence; unified 9-value reason CHECK = holiday | off_hours | customer_hold | non_support_thread | recorded_at_close | answered_before_classified | data_artifact | genuine_miss | other (the UI narrows the dropdown per metric via REASON_OPTIONS). RLS: SELECT = any authenticated; INSERT / UPDATE / DELETE = ADMIN-ONLY via has_role(auth.uid(),'admin') — the Workbench hides the Excuse / clear controls for non-admins but RLS is the real enforcement; created_by records WHO (supabase.auth.getSession() email); saves are upsert onConflict=intercom_conversation_id,metric. WHY ADMIN-GATED EVERYWHERE — AND WHY THIS REVERSED THE EARLIER TRIAGE MODEL: triage overrides originally shipped TEAM-WRITABLE (adoption beats gatekeeping), but every SLA target here is still PROPOSED, not ratified, so an override is not 'excusing a miss against a commitment' — it is EDITING THE EVIDENCE used to argue the targets. So we gate uniformly at admin NOW and loosen later (per-metric RLS, or a committed-flag opening writes only for ratified metrics). Any text still calling triage overrides team-writable is stale. DROPPED/DEAD: public.triage_overrides has been DROPPED (0 rows, unreferenced). public.sla_breach_overrides still physically exists but is a DEAD MIRROR — unreferenced by code, holding 4 stale resolution rows copied into sla_violation_overrides at consolidation; it is a CLEANUP CANDIDATE, not a live table. SURFACE: the Workbench 'Triage violations' + FR/Res breach lists are now ONE unified Violations table with a column per metric (First response · Resolution · Triage · Cadence), each cell excusable through the shared ExcuseDialog writing the matching metric; header carries total violations · excused · OVERRIDE-RATE % · unexcused plus a per-reason breakdown across all metrics. Reason auto-suggestion is per metric: triage → recorded_at_close else answered_before_classified; cadence → customer_hold when the worst gap overlapped a customer-wait. Override-rate stays a tracked RED-FLAG KPI — a high rate means the target or the population is wrong, not that the team is excused; purpose is to WORK THE TAIL so genuine misses stand alone, and one table means a ticket can never be excused in one place and counted in another.",
          "COMMUNICATION CADENCE — the FOURTH SLA metric (engine + all surfaces; 857c4bd Report · a96296a Workbench · 3dc338e Dashboard). WHAT: proactive-update frequency during an ACTIVE incident — how long the customer ever went without a public update from us while the ticket was live. Bound to Sev 1 + Sev 2 ONLY. CADENCE_TARGETS (PROVISIONAL, slaMetrics.ts): Sev1 = 3600s (1h) WALL-clock; Sev2 = 14400s (4h) BUSINESS hours; Sev3/Sev4 = null → rendered as an italic 'no target' chip, NEVER 0%, never a breach. MODEL — PHASE-1 DRUMBEAT: computeCadence(timeline, closeAtS) takes the MAX GAP between consecutive public Lovable updates; customer silence does NOT pause the obligation (a customer reply inside a gap does not reset the clock — the drumbeat is ours to keep) and the window INCLUDES THE TAIL GAP (last Lovable public update → close), so 'went dark, then closed' counts against cadence. Fields spread onto SlaResult inside computeSla — cadenceUpdateCount, cadenceMaxGapS, cadenceMaxGapBusinessHoursS, cadenceMaxGapOverlappedCustomerWait, hasCadence — so every surface reads the ONE engine, no parallel path. evaluateCadence(sla, severity, overrideTargetS?) returns true | false | null on the severity's own clock; the third arg exists ONLY for the what-if slider. DELIBERATELY CONSERVATIVE, AND THE LOW %MET IS A GENUINE FINDING: drumbeat + tail-gap make cadence the strictest metric we have, and the pattern it exposes is BURST-THEN-SILENCE (heavy engagement, then a long quiet stretch before close) — confirmed by a manual hand-walk of the worst Sev 2 gaps, not a measurement artifact. cadenceMaxGapOverlappedCustomerWait marks gaps where we were ALSO waiting on the customer: interpretability + the customer_hold auto-suggestion only, it never silently forgives the gap. HONESTY RULE (charter): evaluable = hasCadence; non-evaluable tickets are EXCLUDED FROM THE DENOMINATOR entirely — never defaulted to met, never counted as a breach — and every surface carries an 'N of M evaluable' coverage line, same rule as triage. SURFACES (all via useSlaBatch): /sla-report §3c 'Communication cadence' — per-Sev %met + median / p90 / longest max-gap, overlapped-customer-wait count, coverage line, 'PROVISIONAL — targets not yet ratified; drumbeat model incl. tail gap' caption. /sla-workbench unified Violations table — a Cadence column; a row counts only when the severity has a target (Sev1/2) AND sla.hasCadence AND evaluateCadence(sla, sev) === false; shows worst gap on the severity's own clock, update count, overlap flag; excusable via ExcuseDialog with metric='cadence' (admin-gated), auto-suggesting customer_hold on overlap. /sla Dashboard scorecard — a 'Cadence (provisional)' column matching the FR/Res cell pattern exactly (tone-coloured %met pill · target + clock · red breach badge linking to the Workbench · excused count · 'N of M evaluable' chip), Sev3/4 = no target, plus a PROVISIONAL footnote and a 'Communication cadence (provisional)' entry in the 'How these are measured' popover. /sla-what-if already exposes LIVE Sev1/Sev2 cadence knobs via evaluateCadence's overrideTargetS (local state only, never persisted) — so cadence is a FULL first-class metric alongside FR / Resolution / Triage. SlaOverrideMetric in useSlaBatch.ts includes 'cadence', so isExcused(cid,'cadence') behaves identically to the other metrics.",
          "TARGET INVARIANT: the triage target (30 min, business hours) must ALWAYS stay ≤ the strictest FRT SLA (Sev 1 FR 30m). Triage is a precondition of a correct first response — you cannot hit a severity-specific FRT target you have not yet assigned a severity for — so if Sev 1 FR ever tightens, TRIAGE_TARGET_S has to move with it. Noted in-code above the constant.",
          "PAIRING INTENT: triage-time + a (still-to-come) global FRT-compliance % are the TWO-PART responsiveness view for leadership, replacing the misleading single 'global FRT average' — an average across severities with different targets and different clocks is not a meaningful number, whereas a severity-agnostic triage median plus a compliance percentage each say something true.",
          "THREE SLA pages, one data spine — division of labour (commit f3bb52f reorg): /sla (SlaDashboard) = live OPS view, rolling window, at-a-glance per-severity scorecard, links out to the Workbench to investigate or override. /sla-report (SlaReport) = the FORMAL MONTHLY report on a calendar month, lean leadership layout. /sla-workbench (SlaWorkbench) = practitioner detail. TECH DEBT (known, flagged deliberately): the rollup/stats logic is COPIED per page (each page has its own computeStats/scorecard code over the same hook) and Dashboard vs Report overlap heavily — a shared rollup module is the obvious next refactor; until then any counting-rule change must be applied to all three pages in lockstep (the FR-basis drift fixed in 91ae443 is exactly what this duplication causes).",
          "UI /customer-report (CustomerReport.tsx, nav 'Customer report', Beaker/experimental) — PROTOTYPE, out to CSMs for feedback. A per-customer SLA + volume view for CSM-style consumption. AUDIENCE/WHY: CSMs do NOT have Intercom access, so ALL detail is self-contained in-app — Intercom conversation IDs render as plain SELECTABLE TEXT (to quote to support), never as deep-links; the ONE external link is the Escalated Issue (Linear). NUMBERS REUSE THE ENGINE: consumes useSlaBatch + evaluateCompliance (no new SLA computation) so figures match Dashboard/Report exactly; currently-open counts come from a light intercom_tickets_v3 query (lifecycle_status ∈ open / reopened_after_finalize) by customer_key; customer list from v3_customer_accounts excluding is_test. FILTERS: searchable customer combobox; date range (This month default / Last month / 30d / 90d, applied to closed rows via finalized_at/closed_at); 'Show closed issues' toggle (default OFF). SUMMARY CARDS: Currently open (per-severity mini-breakdown), Closed in range (per-severity mini-breakdown; Unclassified rendered ONLY when >0 and styled as an anomaly — closed tickets should always be classified), First Response met % (customer-initiated scope), Resolution met %, Breaches, CSAT positive (% of ratings 4–5 on the 1–5 scale, description carries the response COUNT + average). ESCALATED TO DEV table (independent of the Show-closed toggle — always shows open AND closed escalations): criteria = 'Escalated to Engineering' = Yes OR Ticket type ∈ {Bug, Incident}; columns Subject · Intercom ID · Severity · Type · Esc→Eng · Linked issue · State · Created. Linked issue reads the 'Escalated Issue' custom attribute (legacy 'Linear Issue' fallback) and renders a clickable Linear link showing the issue id (e.g. ENT-2804). DELIBERATE: it does NOT scrape notes for Linear URLs — a URL in a note may be a related investigation, not the filed issue. OPEN ISSUES table (always): Subject · Intercom ID · Severity · Created · Last activity (intercom_updated_at) · State — no outcome columns, open tickets have no resolution yet. CLOSED ISSUES table (only when Show-closed is ON): Subject · Intercom ID · Severity · Created · Resolved · First Response (value + met/breach) · Resolution (value + met/breach).",
          "NAV INFORMATION ARCHITECTURE (commit b5b66e0, AppLayout.tsx) — the left rail went from a flat ~17-item alphabetical list to 6 rail items GROUPED BY USE (job-to-be-done), each a hover-flyout: Reports ▸ Analytics (/) · Analytics v3 · Insights · SLA Report | Customer report (standalone top-level link — kept visible because CSMs were already told it's there; folds under Reports later) | Issues ▸ Triage (/triage) · Dev escalations (/escalations) · Inbox (/conversations) · Inbox v3 | Dashboards ▸ SLA Dashboard (/sla) + one entry PER TEAMMATE (see below) | Tools ▸ Import · SLA Workbench · Backlog · Prospects · SLA What-if | Admin ▸ Customers · Settings · Knowledge · Flow · Changelog · SLA Policy (admin-only). WHY by use, not by name: you navigate by INTENT ('report', 'work the queue', 'configure'), and the flat list overflowed a 13\" screen. DELIBERATE TRADEOFF: the SLA family is SPLIT across use-groups (SLA Report→Reports, SLA Dashboard→Dashboards, SLA Workbench→Tools) — mitigated by keeping the family name in the CHILD LABEL so it stays findable by reading. MECHANIC: one generic per-row hover flyout (generalized from the old single hardcoded Dashboards flyout), positioned per group row via getBoundingClientRect().top, with a 150ms close debounce; a group that shrinks to exactly ONE item degrades to a plain link (future-proofing as legacy/v2 options fall off). Only the v2 NAV ENTRIES were removed — /analytics-v2 and /inbox-v2 ROUTES still exist and are reachable by URL; de-nav'd, not deleted, data cleanup is a separate later task. DASHBOARDS GROUP IS NOW DATA-DRIVEN: the per-owner /my/* children are no longer hardcoded — src/hooks/useDashboardTeammates.ts loads public.teammates WHERE active AND show_dashboard AND role <> 'ai', ordered by name, and maps each to { to: '/my/' + lower(name), label: name }; the static /sla entry stays pinned first. show_dashboard is a boolean column on teammates (default false, backfilled true for Joel/Kristina/Tine/Eren/Matt) toggled per row from the Teammates panel in Settings (AdminMappingCard.tsx, admin-gated, switch disabled for role='ai' so Sam can never be listed). Both gates apply: an INACTIVE teammate drops out of the flyout even with show_dashboard=true (this is why Joel — active=false on the roster — no longer appears). Fallback: if the query errors the hook returns the previous hardcoded five so the nav is never empty. SCOPE FENCE: this is nav CURATION, not access control — /my/:owner remains reachable by URL for ANY owner name, and OWNER_OPTIONS (Conversations / ConversationDetail / TestChannelReview) plus OWNER_MAP (BulkImportReview) stay hardcoded because they include non-teammate owners (CSM, Sam) and filter historical data.",
          "OWNER DASHBOARDS V3 (/my-v3/:owner, OwnerDashboardV3.tsx) — a PARALLEL, READ-ONLY mirror of the legacy owner dashboard built on v3 data. WHY: /my/:owner renders Conversations.tsx over the LEGACY tables (conversation_mappings / gmail_conversations / manual_conversations), so a teammate's personal view and every v3 report were counting different populations. POPULATION: intercom_tickets_v3 WHERE owner ilike :owner AND intercom_created_at >= CLEAN_DATA_START_ISO (June 1 2026 v3 floor) AND lifecycle_status <> 'transferred_out', limit 2000. TWO TABS: Active = lifecycle_status ∈ {open, reopened_after_finalize}, OLDEST FIRST (work the queue); Closed = the rest, newest first. Single scroll, no pager. PRESENTATION reuses the shared issue-view template verbatim — IssueTable + issueColumns (id · subject · contact · customer · age) + IssueDetailSheet, displaySubject for Hub subject overrides, useCustomerLabels for customer names. READ-ONLY BY DESIGN: no replies, no field writes, no override tables — editing stays on Triage / Inbox v3 / the ESH write panel. NAV: a second 'Dashboards (v3)' rail group fed by the SAME useDashboardTeammates roster with /my/ rewritten to /my-v3/. PARALLEL, NOT A CUTOVER: legacy /my/:owner stays the default Dashboards group; retiring it is a later decision once the v3 numbers are trusted. VERIFIED: Matt = 21 active / 146 closed, matching direct SQL over the same predicate.",
          "INTERCOM WEBHOOK — ACKNOWLEDGE FIRST, PROCESS IN BACKGROUND (supabase/functions/intercom-webhook/index.ts). WHY: Project monitoring caught POST /functions/v1/intercom-webhook returning 503 x16, 504 x2 and 520 x1 in one log window (2026-08-25). The handler did EVERYTHING inside the request — signature verify, Supabase reads/writes, Intercom conversation fetches, Gmail email/subject matching, Slack posts — so one slow upstream call held the socket until the platform killed it (504), and bursts of concurrent deliveries piled up long-lived instances (503). SHAPE NOW: Deno.serve does ONLY CORS preflight → read body → verifyIntercomSignature (a bad signature still returns 401), then returns 200 {ok:true,accepted:true} IMMEDIATELY and hands the payload to handleEvent(rawBody) through EdgeRuntime.waitUntil. handleEvent is the entire previous handler moved VERBATIM — every topic branch, the dedup claims, the Gmail linking tiers, the cross-thread link guard, pending_intercom_links and the Slack posts are unchanged. Each background run logs '[timing] handleEvent <ms> status=<code>' so branch cost is observable. OUTBOUND TIMEOUTS: a module-level fetch wrapper attaches AbortSignal.timeout(8000) to any call that does not already pass a signal, so a hung Intercom or Slack call fails fast instead of running out the clock. DEAD LETTER — THE REPLACEMENT FOR INTERCOM'S RETRY: because we answer 200 before doing the work, Intercom no longer retries a failure, so recordWebhookFailure() writes public.intercom_webhook_failures (topic, intercom_conversation_id, error, full payload jsonb, created_at, plus replayed_at/replay_ok for later replay) and posts a :shield: alert to #enterprise-support-hub-alerts under the existing 'Support Hub Guard' identity; both are try/catch-wrapped so a dead-letter write can never mask the original error. RLS: authenticated SELECT, service_role full. VERIFIED 2026-08-26: bad-signature POST → 401 (negative case checked); 13 live deliveries after deploy all logged status=200 at 613–1931 ms; intercom_webhook_failures = 0 rows. UNVERIFIED: the 24-hour 503/504/520 count against the 19-failure baseline (window not elapsed), and replay of a stored dead-letter payload (no failure row has occurred yet; no replay UI exists).",
          "UI /sla-workbench (SlaWorkbench.tsx) — practitioner detail / data-behind-it. Tab 1 'Analyze by ID (live)': paste ≤10 ids → sla-ticket-analyze → per-ticket card with headline strip (our Support FRT calendar+BH vs Intercom time_to_admin_reply + Δ + Intercom SLA status), color-coded timeline, calendar|BH metric table, origin+flag badges, prominent internal/no-customer warning. Tab 2 'Population review (snapshot)' (renamed from 'Batch (stored)'): snapshot-based (~287 rows, not live). ComplianceSection at TOP with per-severity columns N, FR target, FR %met, FR breaches, FR n/a, Res target, Res %met, Res breaches, CADENCE target, Cadence %met, Cadence breaches (Sev 3/4 render n/a — no cadence commitment; non-evaluable tickets are excluded from the denominator, never scored as misses). Filters: frBasis (customer-initiated ↔ all, FR only), date window, customer. A UNIFIED VIOLATIONS table covering First response · Resolution · Triage · CADENCE, with a SORT selector (worst-first default, Sev 1-first / Sev 4-first, longest resolution, longest first response, oldest, newest), with Intercom deep-links plus the excuse / remove actions writing sla_violation_overrides — the ONE consolidated override table, ADMIN-ONLY writes (Dashboard and Report just consume them; sla_breach_overrides is a dead mirror, not written). Excused rows in both breach tables render the override REASON and the free-text NOTE inline beneath the 'Excused · {reason}' chip (muted italic, quoted, truncated with the full note in a title tooltip) — commit daebf72, UI-only in ExcuseCell. WHY: notes were captured in sla_violation_overrides.note but were previously only exposed as a native title= hover, invisible on touch and with no affordance ('captured but invisible' gap). SCOPE: Workbench only — the Dashboard intentionally stays aggregate (excused COUNT only). 'Work Before Ticket' card (max(0, B − A) stats + by-source breakdown). 'Excluded from population — by reason' card (the 8-reason breakdown: not_enterprise, fyi+duplicate, merged_ticket, rsa_override=false, test_account, prospect_personal, enterprise_prospect, manually-logged). BY-SOURCE breakout (Slack · Sam-first · Direct + greyed Manually-logged): n · FR %met · Res %met · Pre-inbox median — why: the aggregate hid three very different populations (Sam-first strongest, Slack weakest with large pre-inbox lag; Sam first-lines EMAIL/MESSENGER only — 0 public Sam replies on Slack-sourced tickets). KPI tiles: Support FR bh + calendar (inbox-anchored), first response any-agent, TTR bh, Pre-inbox time (labelled 'process signal, not an SLA'). Full sortable per-ticket table + shared 'Show test data' toggle.",
          "UI /triage (Triage.tsx, Issues flyout, READ-ONLY) — the LIVE triage queue: every OPEN Enterprise-Inbox ticket with NO Severity custom attribute, oldest first, colour-graded against the triage target. Complements the retrospective triage numbers on Report/Workbench, which only cover CLOSED tickets. POPULATION: intercom_tickets_v3 where lifecycle_status IN (open, reopened_after_finalize) AND custom_attributes.Severity is absent/blank — closed tickets are out by construction since Severity is required before close. AGE CLOCK: business-hours elapsed via businessHoursBetween using the POLICY-RESOLVED businessHours from useSlaPolicy (active version; falls back loudly to engine defaults through PolicyFallbackBanner). Wall-clock elapsed is a muted SECONDARY column, never the graded number. ANCHOR: computeSla().slaClockStartS (first Enterprise-Inbox team assignment) else createdAtS; each row LABELS which anchor it used ('inbox assignment' / 'ticket created') so the age is never unexplained. TARGET: activePolicy.triageTargetS (1800s / 30 min, PROVISIONAL) read from the config tables, not a constant. BANDS (% of target): OK <50%, Approaching 50-80%, At risk 80-100%, Breached >100% — row tint + pill + per-band counters. FRESHNESS: no live Intercom feed; sync-v3-open-frequent runs */5 * * * * so a newly-triaged ticket leaves the queue within ~5 min; header shows 'Data as of {max(last_synced_at)} · syncs every 5 min' plus manual refresh, and a 30s local tick advances ages/bands without refetching. READ-ONLY BY DESIGN: no writes, no override table, no Severity assignment from here — assigning triage in-app is a deliberate later step.",
          "UI /escalations (Escalations.tsx, Issues flyout) — the DEV ESCALATION BOARD: Intercom tickets typed as a Bug or Feature Request, paired with their Linear escalation issue, under a lifecycle THE HUB OWNS. WHY: Intercom closes a conversation when support is done, but the work is not done until the CUSTOMER HAS BEEN TOLD the fix shipped — so Intercom state must not drive this board. POPULATION (automatic, no sync job): intercom_tickets_v3 where custom_attributes->>'Ticket type' IN (Bug, Feature Request), excluding lifecycle_status='transferred_out' and customer_resolution_method='not_enterprise' (same exclusions as every other v3 surface). Intercom state is an INFORMATIONAL COLUMN ONLY, never a filter. 22 tickets qualified at build (9 Bug / 13 Feature Request). HUB STATE: open → in_progress → fix_shipped → customer_notified, plus terminal wont_do; board defaults to 'active only' (hides the two terminal states). VIRTUAL OPEN ROWS: a qualifying ticket renders at open with NO ROW WRITTEN — public.dev_escalations is inserted only on the first human decision (state change, Linear link, or note), so the table holds DECISIONS, never a mirror of Intercom; nothing to backfill, nothing to drift. LINEAR — PHASE 1 IS LINK-ONLY: resolved in priority order Hub linear_url_override → custom_attributes.'Linear Issue' → custom_attributes.'Escalated Issue'; full linear.app URLs and bare KEY-123 keys both resolve, and anything else (some Escalated Issue values are Slack permalinks) is shown VERBATIM AND UNLINKED rather than guessed at. PHASE-2 READY, DELIBERATELY BLANK: linear_key / linear_title / linear_state / linear_assignee / linear_synced_at exist from day one and render '—' until a sync-linear-escalations edge function is added against the Linear connector gateway (one function + one cron, no migration, no UI rewrite) — never faked in the meantime. SCHEMA public.dev_escalations: intercom_conversation_id UNIQUE (join key + upsert target), hub_state CHECK over the five states, linear_url_override, note, owner, state_changed_at (stamped on every state write), notified_at (additionally stamped on customer_notified), the five phase-2 Linear columns, created_by/created_at/updated_at with the shared update_updated_at_column trigger. RLS mirrors esh_backlog_items: any authenticated user selects/inserts/updates, DELETE admin-only. TABLE: Type · Subject+contact · Customer · Owner · Intercom state · Linear · Hub state (inline select) · Age (days since intercom_created_at) · Note; sorted OLDEST FIRST; filters hub state / type / owner / customer + free-text search; per-state counters above the table. LINEAR PHASE 2 (LIVE): sync-linear-escalations edge function, cron sync-linear-escalations-daily at 05:50 UTC plus an on-demand 'Sync Linear' button (editor-gated) on the board. READ-ONLY AGAINST LINEAR — it never writes to Linear, and in the Hub it writes ONLY linear_key/linear_title/linear_state/linear_assignee/linear_synced_at; hub_state, note, owner and linear_url_override stay human-owned. Keys are resolved with the SAME priority chain as the UI (override → 'Linear Issue' → 'Escalated Issue'), split into team key + number and looked up one issue at a time through the connector gateway (POST /linear/graphql, issues(filter:{team:{key:{eq}},number:{eq}})); capped at 200 keys per run. Rows ARE created for referenced tickets with no Hub row yet (hub_state defaults to open) — a deliberate narrowing of the 'virtual open rows' rule so live Linear metadata does not require a human touch first. A gateway non-200 ABORTS the run and is surfaced with status+body (never mistaken for 'issue not found'); unresolvable keys come back in not_found. Health key linear_escalation_sync in integration_health. FIRST RUN 2026-08-24: 32 candidates, 30 distinct keys, 27 resolved, 29 rows written, 3 not found (AGE-993, INTX-1634, SCA-2893 — likely teams the connection's token cannot read; UNVERIFIED which). REDESIGN 2026-08-26: the board is now TWO QUEUES behind one segmented control — 'Needs Linear' (qualifying tickets with no resolvable Linear issue; the safety net for the rule that every bug/feature request gets a Linear issue) / 'Linked' / 'All' — with one table on screen at a time. Columns cut to Intercom ID · Subject · Customer · Type · Linear · Hub state · Age; Contact, Owner, Intercom state, the Linear mirror fields and the Linear override moved into the shared IssueDetailSheet opened by row click. The info banner became an info popover; the five state pills became the queue counts plus the existing state filter; owner/customer/type filters moved behind a 'More filters' popover. NOTES MOVED OFF THE BOARD: dev_escalations.note is no longer read or written — notes are now rows in public.conversation_notes keyed by the v3 ticket uuid with conversation_source='intercom_v3' (component src/components/issues/TicketNotes.tsx, batched loader fetchV3Notes), so a note is threaded, authored, timestamped and portable to any surface that reads v3 notes; page search indexes note text. The dev_escalations.note column is retained unread as the rollback path. One-time copy of existing notes ran 2026-08-26 and moved 0 rows — VERIFIED: 0 of 33 dev_escalations rows carried a note. POPULATION BROADENED 2026-08-31: one shared predicate qualifies(ticket, override) drives both the row build and the batched notes prefetch — a ticket qualifies when Ticket type is Bug / Feature Request / Incident, OR it carries any resolvable Linear reference (override → 'Linear Issue' → 'Escalated Issue') at ANY type; transferred_out / not_enterprise exclusions unchanged. WHY: escalations typed Issue (SCA-3522, Intercom 215475673305527) or Question (CLO-1225, 215475556254768) had Linear links but never entered the board, so they were unsearchable. CORRECTED SAME DAY: the first cut also treated Issue as a qualifying TYPE, which admitted 195 unlinked tickets never escalated to dev (a 217-row 'Needs Linear' queue with no value); Issue was removed as a type and now enters only via its Linear link. VERIFIED by SQL 2026-08-31: 44 Bug/Feature Request/Incident (19 of them unlinked = the real Needs-Linear queue) + 25 linked tickets of other types (19 Issue, 6 Question/Configuration/untyped) = 69 rows, vs 39 under the old type-only gate. A ticket admitted by the link rule can never sit in Needs Linear. SEARCH VISIBILITY: matchesSearch() is factored out and reused to show per-queue hit counts on the tab labels and a hint (with a one-click switch to State: all) when hits are hidden by the state filter — search indexing itself is unchanged. DEV FOLLOW-UP 2026-08-31: dev_escalations gains dev_followed_up_at / dev_followed_up_by (Hub-owned, nullable, never synced). 'Dev follow-up' column shows Today / Nd ago / Never (Never sorts oldest); detail sheet has editor-gated 'Mark followed up now' and 'Clear', stamped with the signed-in user's email. No writes to Linear or Intercom. DEV FOLLOW-UP 2026-08-31: dev_escalations gains dev_followed_up_at / dev_followed_up_by (Hub-owned, nullable). A 'Dev follow-up' column shows days since the last chase ('Never' sorts as oldest) and the detail sheet has 'Mark followed up now' / 'Clear', editor-gated; stamped with the signed-in user's email. Nothing is written to Linear or Intercom.",
          "SHARED ISSUE-VIEW TEMPLATE (presentation-only standardisation) — the v3 ticket views were drifting apart: Inbox v3 already used a clickable Intercom ID chip + row-click detail Sheet, while /prospects, /triage and /escalations used a trailing ExternalLink icon, no row interaction, and each page carried its OWN copy of the intercom deep-link helper and its OWN accountLabel map. FOUR SHARED PIECES: src/lib/intercom.ts (intercomUrl — the single canonical Enterprise-inbox deep link), src/hooks/useCustomerLabels.ts (one customer_key → label resolver, covering prospect_unmapped / prospect_personal / domain:* cases), src/components/issues/IssueTable.tsx (generic IssueTable<T> + the IntercomIdChip affordance + row-click support) and src/components/issues/issueColumns.tsx (column factories: idColumn, subjectColumn, contactColumn, customerColumn, ownerColumn, ageColumn), with src/components/issues/IssueDetailSheet.tsx as the standard read-only overlay. CANONICAL COLUMN ORDER: Intercom ID (chip; click opens Intercom, stopPropagation so it never triggers the row) · Subject · Contact · Customer · Owner · page-specific columns · Age last. APPLIED TO: /prospects and /triage (fully migrated; Triage gained a detail sheet it never had), /escalations (migrated while keeping its inline Hub-state select, Linear override input and note editor inside the shared cells), and Inbox v3 (kept its own table blocks but now uses the shared intercomUrl + IntercomIdChip, and the Transferred table ID column moved to first position). SCOPE FENCE: PRESENTATION ONLY — no query, population, engine, policy or write-path change; row sets and numbers are identical to before.",
          "SHARED SLA DATE-WINDOW (src/lib/slaWindow.ts, commit 8f35047) — one module drives the 'Window' selector (and therefore the breach cards) on BOTH /sla and /sla-workbench: DateWindow, WINDOW_LABELS, WINDOW_CAPTIONS, windowRange, windowStartMs, rowClosedAtMs; both dropdowns render Object.keys(WINDOW_LABELS) so options appear on both pages automatically. Options: 7d · 30d · 90d · month ('This month') · last_month ('Last month', caption 'resolved last month', rendered right AFTER 'This month') · all. last_month is the FIRST BOUNDED window — the previous CALENDAR month, [first-of-previous-month → first-of-this-month), END EXCLUSIVE; every other window is open-ended 'since X → now'. windowRange(w, now) returns { startMs, endMs }: all → {null,null}; 7d/30d/90d → {now−Nd, null}; month → {first-of-this-month, null}; last_month → {first-of-previous-month, first-of-this-month} — endMs is null for everything except last_month. windowStartMs is kept and delegates to windowRange(...).startMs so existing callers don't break. The close-date filters in SlaDashboard and SlaWorkbench apply BOTH bounds: keep a row when (startMs == null || closeMs >= startMs) && (endMs == null || closeMs < endMs), so all pre-existing windows behave exactly as before. WHY: a monthly review needs the previous COMPLETED calendar month — 'This month' is partial and the rolling windows straddle month boundaries. /sla-report already offered last month via its own monthOptions dropdown; this closes the same gap on the Dashboard + Workbench breach cards. UI/filter-only — no engine, hook, target or schema change.",
          "UI /sla-report (SlaReport.tsx, nav 'SLA Report', protected, read-only) — the FORMAL MONTHLY SLA Report and a DATA-BACKED TARGET PROPOSAL, not a compliance scorecard. Reuses useSlaBatch / computeSla / evaluateCompliance / aggregate / SLA_TARGETS + rowClosedAtMs — no engine, hook or resolver changes. Why framed as a proposal: SLA_TARGETS is explicitly PROVISIONAL, so every '% met' is labelled 'vs PROPOSED target' under a top banner ('Proposed SLA targets — performance baseline for calibration, not committed-SLA compliance') and the Median/p90 distributions in §3 are the headline evidence for where targets should be set. Population = the hook's inScope (all Enterprise finalized/reopened), NO owner filter; month selector (last 12, default current calendar month), membership = finalized-in-month via rowClosedAtMs. LEAN leadership layout after the f3bb52f reorg: proposal banner → §1 Scope & Population (population count; severity reconciliation with ✓/✗ MISMATCH and a LOUD 'Unclassified severity: N' block — unscoreable rows stay IN the population, never dropped; exclusions condensed to a single count line that points at the Workbench for the by-reason breakdown) → §2 Headline (overall FR %met + Res %met with met / breach / excused / not-evaluable counts, NO median/p90/avg — those are per-severity evidence, not a rollup number) → §3a/§3b by-severity scorecard (n · Target+clock · %met · not-evaluable · Avg · Median · p90) → §4 Breach SUMMARY (unexcused FR + Res counts, override rate, link to the Workbench for per-ticket detail + excuse/remove) → §5 lean By Source (Source · n · FR %met · Res %met · Pre-inbox median) → §6 caveats / data-quality footer. Work-Before-Ticket and the per-reason exclusion table were MOVED OFF this page to the Workbench — leadership reads outcomes, practitioners read detail. COUNTING RULES: %met = met_true / (met_true + unexcused breach); excused AND not-evaluable are BOTH excluded from the denominator and shown as their own counts (different kinds of non-data-point — folding either in would silently move the headline). First Response counts CUSTOMER-INITIATED rows only (same basis as Dashboard/Workbench). Sev 4 Resolution has no committed target → 'no target (best-effort)', no %met, distribution still shown. Clock basis is per severity: Sev 1 calendar/24-7, Sev 2–4 Berlin business hours. Includes the shared 'Show test data' toggle + banner (test-account tickets excluded by default).",

          "Why it beats Intercom (mechanism): Intercom's time_to_admin_reply / SLA status miscount tickets where a teammate replied in Slack (mirrored as type='user'), inflating first-response and mis-marking SLAs 'missed'. Our @lovable.dev + Sam-by-id classification recovers the true first human/agent response. Confirmed on real tickets (Checkr ~35h+'missed' vs true ~8h; Frontlineed CSM reply dropped entirely).",
          "SLA POLICY CONFIG — targets are DATA, not code (sla_policy_versions + sla_policy_targets). WHY: leadership judged Sev 1 wall-clock 24/7 too aggressive, and changing a hardcoded constant silently re-scored all history with no record of what the commitment WAS. A policy version is an IMMUTABLE SNAPSHOT (all targets + business_hours + effective_from + status). A ticket is scored against the version in force at its INBOUND ANCHOR (slaClockStartS, else created_at) — the SLA in force when it arrived — ONE version per ticket, never switching mid-ticket. provisional versions may be edited and re-score history freely (calibration — where we are today); committed versions are meant to freeze once their effective date passes (contractual, no retroactively moving goalposts). This is how the provisional targets get ratified.",
          "Schema. sla_policy_versions: effective_from, status ∈ provisional|committed, business_hours jsonb { tz, work_days[], day_start_hour, day_end_hour, holidays[] }, label, audit (created_by/at, updated_by/at). sla_policy_targets: version_id, metric ∈ first_response|resolution|cadence|triage, severity 1–4 (NULL for triage — severity-agnostic), target_seconds (NULL is MEANINGFUL: explicit 'no target', never 'unset'), clock ∈ business|wall. UNIQUE (version_id, metric, severity) + a PARTIAL unique index on (version_id, metric) WHERE severity IS NULL, because Postgres treats NULL severities as distinct (so the triage row is upserted match-then-write, not via onConflict). RLS: SELECT for authenticated, ALL writes admin-only via has_role(auth.uid(),'admin'). Clock vocab differs on purpose: DB says 'wall', engine says 'calendar' — policyToEngine translates.",
          "CURRENT LIVE VALUES (one version: 'Seed from code constants (provisional)', effective_from 2026-01-01T00:00:00Z, status provisional). First Response: Sev1 1800s BUSINESS · Sev2 14400s business · Sev3 54000s business · Sev4 162000s business. Resolution: Sev1 28800s · Sev2 108000s · Sev3 270000s · Sev4 NULL (best-effort), all business. Cadence: Sev1 3600s BUSINESS · Sev2 14400s business · Sev3/Sev4 NULL (no target). Triage: single severity-NULL row, 1800s business. Business hours: Europe/Berlin, Mon–Fri (work_days [1,2,3,4,5]), 09:00–24:00, holidays []. NOTE the deliberate drift: Sev1 First Response AND Sev1 Cadence were moved to the BUSINESS clock in the data (the engine constants still say calendar) — the constants are only the fallback; the DB is what the surfaces score against.",
          "Engine + surfaces. policyToEngine(version, targets) maps DB rows to engine shapes (wall → calendar); resolvePolicy(anchorMs, policies) picks the latest version with effective_from <= anchor, else null. businessHoursBetween / businessDaySeconds / formatBusinessDuration take an injectable config, DEFAULTING to DEFAULT_BUSINESS_HOURS (= the OLD constants, retained as fallback), with generic Intl-based tz handling. computeSla(conversation, opts?, businessHours) threads the calendar into computeTriage + computeCadence. useSlaPolicy.ts = read-only loader (never writes). useSlaBatch does TWO passes: pass 1 with the default calendar purely to derive the inbound anchor (a wall-clock timestamp, so it can't depend on business hours), then re-computes ONLY if the resolved calendar actually differs; each row carries policy + policyFallback, and the hook exposes activePolicy (for target LABELS), policyError, resolveForAnchor, policyConfigLoaded. SlaReport / SlaDashboard / SlaWorkbench score every row against row.policy. PolicyFallbackBanner renders LOUDLY on all three when the config fails to load, is empty, or a ticket predates every version — never a silent default. SlaWhatIf still reads the constants for now.",
          "Admin panel /sla-policy (SlaPolicyAdmin.tsx, Admin flyout). Admin-gated in three places — nav (adminOnly NavChild filtered by useIsAdmin), route (non-admins get a 'Not authorized' card), and save controls — with RLS as the authoritative gate. v1 model: edit the SINGLE provisional version IN PLACE (no version creation yet). Grid = Sev 1–4 × First Response / Resolution / Cadence + one Triage row; each cell has a duration and a clock, and an empty value writes the explicit 'no target' NULL. Business-hours editor: timezone, working days, day start/end hour, holidays list. Loud blocking validation (bad durations, start >= end, malformed YYYY-MM-DD holidays). KNOWN-NOT-YET: holidays are stored but the engine does not consume them; SlaWhatIf baseline is still constants; commit/go-live + future-dated-version enforcement is a later addition (schema already supports it).",
          "Caveats when reading numbers: OPEN tickets (~10%) excluded from Batch (raw_payload has no conversation_parts in snapshot) → resolution optimistically biased; company holidays stored on the policy version but not yet consumed by the engine; the single live policy version is provisional/unratified; pre-inbox time mixes Sam-handling with pre-ticket Slack work (future split).",
          "Known open items: split pre-inbox time (Sam-first vs Slack-native); no-customer/CSM own-pool treatment; stored-payload completeness for Slack; manual initiation-override to correct forwarded-email misclassification; holiday-aware business-hours (consume the stored list); commit/go-live flow for future-dated policy versions; SlaWhatIf cut-over from constants to the live policy; aggregate dashboard + SLA compliance slider (plumbing exists, UI wiring after target ratification).",

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
  { id: "e-sev-ai-triage", source: "severity-ai-proposal", target: "triage-severity-write", label: "proposes (human accepts)", animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e-triage-sev-write", source: "triage-severity-write", target: "esh-write-action", label: "set_severity", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },

  { id: "e-field-options-write", source: "intercom-field-options", target: "esh-write-action", label: "allowed values", animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
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
