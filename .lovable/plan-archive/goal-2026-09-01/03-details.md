## What changes

**Remove three convert blocks.** In `slack-interactions` (poll-based auto-escalation, and the 👎 `feedback_negative` handler) and `intercom-webhook` (webhook auto-escalation), drop the `POST /conversations/{id}/convert` call and the `conversation_mappings.intercom_ticket_id` write that follows it. Keep the reassign-to-inbox call immediately above each one, and keep the status/reaction/notice logic unchanged.

**Keep every ticket-aware read path.** Intercom cannot un-convert, so the 44 existing tickets stay tickets. `isTicketPayload` / `isFinalizedTicketState` / `isClosedLike` in `_shared/v3.ts`, the `ticket.state ∈ {resolved, archived}` finalize branch in `sync-v3-open`, the ticket handling in `_shared/v3-finalize.ts`, and the `ticket.state.updated` topic in `intercom-webhook` all stay. They stop accruing new cases and become legacy-only.

**Keep the `intercom_ticket_id` column.** It stops being written for new escalations; the 43 historical values stay readable, per the standing keep-dead-code-as-rollback convention.

## What this improves

New escalations close as normal conversations (`state = "closed"`), so `sync-v3-closed`'s `state=closed` search sees them directly. The current workaround — tickets keeping top-level `state="open"` forever and needing `sync-v3-open` to notice `ticket.state` and call `finalizeConversation` — stops applying to anything new.

## Verification before calling it done

1. Confirm the Slack reply relay is unaffected: `slack-events` already routes replies by `intercom_conversation_id`, never by ticket id (line ~797) — re-read and confirm rather than assume.
2. Trigger one 👎 escalation on a test thread; confirm in Intercom that it lands in the enterprise inbox and is still a Conversation, and that `intercom_ticket_id` stays null on the mapping row.
3. Trigger one AI auto-escalation (or replay the webhook path); same two checks.
4. Close that test conversation and confirm it finalizes through the normal `sync-v3-closed` path — not the ticket branch.
5. Re-check that a legacy ticket (one of the 5 still open) still finalizes correctly after the change.

Steps 2, 3 and 5 are the ones that decide this; without them the change is UNVERIFIED.

## Outside the Hub — worth checking first

The Hub controls whether conversion happens, but not what Intercom does with tickets afterwards. If any Intercom-side view, workflow, macro, SLA or report filters on "Ticket" or on ticket type 1, those surfaces go empty for new escalations. Nothing in this codebase can tell me whether such a view exists — that check is on the Intercom side and should happen before the change ships.

## Doc pass

Per the standing convention: `.lovable/project-knowledge.md` (Step 6b and the auto-escalation bullet both currently document the conversion), the `slack-interactions` / escalation nodes in `FlowDiagram.tsx`, and a `changelog_entries` row recording the removal, the legacy-ticket retention, and the counts.
