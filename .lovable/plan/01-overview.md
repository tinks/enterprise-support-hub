## Goal

Stop the Hub converting Intercom conversations into Intercom Tickets on escalation, so every Intercom issue the Hub touches stays a Conversation.

## What actually converts today

Three call sites, all `POST /conversations/{id}/convert` with `ticket_type_id: "1"`, all owned by this project:

| Where | Trigger |
|---|---|
| `slack-interactions` ~line 693 | Sam AI auto-escalation detected during reply polling |
| `slack-interactions` ~line 1702 | Manual 👎 "Escalate to human" in Slack |
| `intercom-webhook` ~line 1690 | Sam AI auto-escalation detected via webhook (later replies) |

Each does the same two steps: reassign the conversation to the enterprise team inbox, then convert. Only the second step goes away. Reassignment, the `escalated` status, the reaction swap (👀 → ⏳) and the escalation notice all stay exactly as they are.

## Scope of the change

Removing the three convert calls is the whole behavioral change. Everything else in the plan is about not breaking the 44 tickets that already exist — Intercom has no un-convert, so those stay tickets forever and every ticket-aware read path has to stay in place.

Verified counts (v3 rows created since 2026-06-01): 643 total, 44 are converted Tickets, 5 of those still open.
