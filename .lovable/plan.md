## April 2026 Intercom coverage check

I queried Intercom directly for the enterprise inbox (`team_assignee_id = 8484447`) for the window **2026-04-01 → 2026-04-28 (today)** and compared against everything tracked locally (`manual_conversations`, `conversation_mappings`, `gmail_conversations` with a non-null `intercom_conversation_id`).

| Source | April count |
|---|---|
| Currently in Intercom enterprise inbox | **163** |
| Tracked locally with an Intercom ID (created in April) | 376 |
| **Of the 163 inbox tickets — missing locally** | **3** |

The 376 > 163 is expected: many April tickets were tracked while in the enterprise inbox and have since been reassigned/closed and moved out. The relevant gap is the **3 tickets currently sitting in the enterprise inbox that we never picked up**:

- `215473994501379`
- `215473922409590`
- `215473738186057`

## What I'll do

Run the existing `backfill-enterprise-inbox` edge function scoped to April 2026 (`createdAfter = 1775001600`, `createdBefore = 1777334400`). That function:

- Pages through `team_assignee_id = 8484447` for the time window
- Skips anything already in `manual_conversations`, `conversation_mappings`, or `gmail_conversations`
- Links to an existing Gmail thread by contact email when possible, otherwise inserts a `manual_conversations` row (`source: intercom`) with all messages, correct earliest-message `created_at`, owner via `admin_owner_map`, and resolved status if closed

I'll loop the function with its returned `nextStartingAfter` cursor until `done: true`, then re-run the missing-IDs check to confirm we're at 0 and report back the final count of newly imported rows.

## Out of scope

- **Tickets that were in the enterprise inbox during April but have since been reassigned out.** The `team_assignee_id` filter only matches the *current* assignee, so Intercom search can't surface them retroactively. If you want those too, we'd need a separate sweep using `created_at`-only (no team filter) — much larger pull, and most results would be unrelated tickets that legitimately never belonged to enterprise. Happy to do it if you want, but I'd recommend skipping unless you have a specific reason.
- No code changes — purely a data backfill using the existing function.
