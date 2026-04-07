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
  CheckCircle2,
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
/*  and computes first-response-time + thread duration. A "Create     */
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
/*  at 300ms, limited to 200 rows per source.                          */
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
/* ------------------------------------------------------------------ */
/*  Owner tracking: each conversation (Slack, Gmail, Manual) has an    */
/*  owner column (Joel or Kristina). Assignable inline from the        */
/*  Conversations table and the detail view Classification card.       */
/*  Owner filter dropdown lets users filter by owner or unassigned.    */
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
          "Conversations tab resolves channel IDs to names via list-slack-channels (bot token first, connector fallback)",
           "Conversations tab has 'Product area' dropdown (SSO, SCIM, Credits, Account access, Remix/transfer, Cloud/AI), 'Bug' toggle, and 'Feature request' toggle per row, persisted to DB",
           "Conversations tab has multi-select status filter (popover with checkboxes) to hide/show: active, awaiting_context (labelled 'Awaiting customer'), awaiting_support, escalated, resolved, cancelled, test — defaults to hiding test, cancelled, resolved",
           "Status display labels: awaiting_context → 'Awaiting customer', awaiting_support → 'Awaiting support' (DB values unchanged)",
           "Status is editable inline from the conversations list via a dropdown (active, resolved, cancelled, escalated, awaiting_context, awaiting_support)",
           "Import page has free-form 'Log conversation manually' for Teams/phone/Slack DM/Private chat/other threads — saves to manual_conversations + manual_messages tables, shown in Conversations with source filter 'Manual'",
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
          "If no action after 15 min → cron posts reminder in thread",
          "If no action after 30 min → cron auto-proceeds (creates ticket automatically)",
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
           "Webhook fallback: intercom-webhook handles human admin replies + subsequent messages",
           "Webhook dedup is monotonic: only newer part IDs can claim last_intercom_part_id (lt guard), so stale retries cannot re-post the same Sam reply",
          "Removes old feedback buttons from thread", 
          "Posts reply (split at 2900 chars)",
          "Forwards Intercom attachments + inline images (deduped) to Slack",
          "Detects incident.io action → fetches live status from status.lovable.dev and posts status block with subscribe link",
           "Detects escalation keywords in AI reply → if Sam routes to humans, buttons are omitted and status set to escalated",
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
          "Removes all feedback buttons",
          "Removes 👀 and ⏳, adds ✅",
          "Posts resolution notice",
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
        desc: "When a conversation is assigned to the enterprise inbox in Intercom, the webhook auto-imports it into manual_conversations if it's not already tracked via Slack or Gmail.",
        icon: Ticket,
        edgeFunction: "intercom-webhook",
        details: [
521:           "Listens for assignment webhook topics: conversation.admin.assigned, conversation.admin.open.assigned, ticket.admin.assigned, ticket.team.assigned",
          "Checks team_assignee_id matches settings.intercom_inbox_id (enterprise inbox)",
          "Deduplicates across conversation_mappings, gmail_conversations, and manual_conversations",
          "Fetches full conversation from Intercom API with pagination",
          "Extracts messages: skips bots, notes, system events (open/close); assignment parts with body are included",
          "Inserts into manual_conversations (source='intercom') + manual_messages",
          "Conversations from other channels (web, mobile, non-enterprise email) get tracked automatically",
          "Live reply tracking: subsequent replies in Intercom are appended to manual_messages via webhook fallback (no Slack forwarding needed)",
          "Auto-owner: resolves admin_assignee_id via settings.admin_owner_map (JSON) to set owner at import time; also updates owner on already-tracked conversations when reassigned",
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
           "Stats page deduplicates by subject: emails with the same subject count as 1 thread ('Email total' metric), raw count shown as 'Gmail messages'",
           "Internal-only threads (all participants @lovable.dev) are excluded from all Gmail metrics — Email total, Gmail messages, Gmail open, resolution times, customer domains",
           "Activity by hour of day (CET): bar chart on Stats page shows Slack + Gmail activity bucketed by hour using Europe/Berlin timezone",
           "Activity heatmap: 7×24 grid (Mon–Sun × 00–23 CET) with color intensity showing conversation density; respects source filter; tooltip shows Slack + Gmail breakdown; cells are clickable — navigates to /conversations filtered by that day+hour",
           "Heatmap drill-down: Conversations page detects day+hour query params → loads up to 1000 rows/source (vs default 50), filters client-side by CET day+hour, shows filter banner with 'Back to stats' (→ /) and 'Clear filter' buttons, hides 'Load more'",
          "Hybrid resolution tracking: emails have status (open/resolved) and resolved_at timestamp",
          "Manual resolve: users can mark Gmail threads as resolved from Conversations UI",
          "Auto-close: pg_cron runs hourly — threads with no new messages for 24h are auto-resolved",
          "Resolution time = resolved_at minus earliest received_at in the thread",
          "Stats page shows Gmail resolved/open counts and median/avg resolution time — both are deduplicated by subject (same thread = 1 count), matching the 'Email total' dedup logic",
           "Read-only: no replies from dashboard",
           "Auto-Intercom lookup: when a Gmail thread detail page loads without an intercom_conversation_id, the system searches Intercom by customer email (auto-detects customer vs support DL) AND by email subject, deduplicates results, strips HTML from titles — user can link with one click, syncs to sibling threads",
           "Import tab: paste a Slack thread URL to manually import it as a conversation — the edge function parses the URL, fetches the thread parent from Slack, and inserts a conversation_mappings row with status 'active'",
        ],
        accent: "orange",
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
