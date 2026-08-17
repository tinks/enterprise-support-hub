# Step 3 — owner and product area

Second write action set on the `esh-write-action` spine. Same contract as severity: Intercom first, 2xx, re-read, then mirror. No optimistic update, refusals visible inline, every attempt audited.

What makes step 3 different from step 2:

- **Two different Intercom mechanisms, not one.** Product area is a custom attribute (`Affected Product Area`) — same PUT shape as severity. Owner is not an attribute at all: `intercom_tickets_v3.owner` is derived by the sync functions from `admin_assignee_id` through `settings.admin_owner_map`. So writing an owner means a real Intercom **assignment** (`POST /conversations/{id}/parts`, `message_type: "assignment"`), not a field set. Two handlers.
- **First conflict case.** Severity was written only where none existed. Owner and product area may already hold a value, and the 5-minute sync can move them underneath you. Every write therefore carries an expected-current-value and is refused if Intercom disagrees.
- **Two surfaces.** Triage detail sheet and the Inbox v3 detail sheet, both through the same shared control.

## Decisions — settled

**D1 — owner semantics: assignment is the write.** Hub assigns the conversation to that teammate's `intercom_admin_id`; `owner` updates because the sync's own mapping now resolves to them. One source of truth, and it moves the ticket in Intercom's inbox for real. A teammate without an Intercom admin id is refused rather than recorded locally.

**D2 — conflict strictness: strict.** The value the UI displayed is sent as `expectedCurrent`; the function re-reads Intercom before writing and refuses with "Intercom now holds X" if it differs. One extra GET per write, and no silent overwrite of anything that moved since page load.

**D3 — negative tests.** Kill-switch-off and not-allowlisted stay mandatory. Step 3 adds the **stale-value refusal**, forced by changing the field in Intercom between the page load and the write. All three are proven live, and step 4 does not start until you have confirmed them.
