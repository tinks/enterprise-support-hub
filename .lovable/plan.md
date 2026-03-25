

## Update Project Knowledge Document to Match Current State

### Differences Found

Here are all the discrepancies between `.lovable/project-knowledge.md` and the current codebase:

---

**1. Routes table is outdated (Section 2 — UI Pages)**

Current doc says `/` is Settings. Actually:
- `/` → Stats (home page)
- `/settings` → Settings (Index)
- `/knowledge` → Project Knowledge (missing entirely)

**2. Missing: "Cancel" button in context prompt (Sections 2, 5, 6)**

- Step 2 says "two buttons: Add Details and Proceed" → now three: Add Details, Proceed, Cancel
- No Step 3c for Cancel flow
- Status flow diagram missing `cancelled` status
- Status table missing `cancelled` row

**3. Missing: `cancelled` status (Section 5)**

Status flow should include:
```
awaiting_context → cancelled
```
And the status table needs: `cancelled` — User dismissed the request without creating a ticket.

Stats page filters out cancelled conversations.

**4. Missing: `request_cancelled` bot message (Section 8)**

The `bot_messages` table now has a `request_cancelled` key used when the Cancel button is clicked.

**5. Missing: DM support (Sections 6, Step 1)**

Step 1 only mentions @mentions. The bot now also handles direct messages from workspace members (`channel_type === "im"`), using the same flow.

**6. Intercom part dedup changed to RPC (Section 10)**

Doc says "Atomic UPDATE on `last_intercom_part_id`" for webhook dedup. It now uses a Postgres function `claim_intercom_part` with `SELECT ... FOR UPDATE` row locking.

**7. Missing: Channel name overrides (Section 11 or new)**

`src/lib/channelOverrides.ts` provides manual name mappings for private channels the API can't resolve.

**8. Missing: Error recovery on modal close/submit failures (Section 6, Step 3a)**

The `view_closed` and `view_submission` catch blocks now reset status to `awaiting_context` and restore the prompt with buttons if ticket creation fails, preventing the "Gathering your details…" freeze.

**9. `knowledge_documents` table missing from DB tables list (Section 2)**

The table exists and is used by the Knowledge page but isn't listed in the Architecture section.

---

### Plan

Update `.lovable/project-knowledge.md` with all 9 corrections above. Since the AI must follow the pending-content workflow, this will be written to `pending_content` via a database migration/RPC so you can review and approve it in the Knowledge tab.

**Single action:** Write the updated markdown to `pending_content` + `pending_summary` on the `knowledge_documents` row, then you review the diff in the Knowledge tab.

