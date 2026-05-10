## Problem

Gmail card on the Stats page shows `Received 41 / Resolved 34 / Open 0` for April. The 7 missing threads aren't gone — they're in non-`open`, non-`resolved` statuses (`awaiting_context`, `awaiting_customer`, `awaiting_support`, `active`) that the "Open" tile doesn't count.

DB confirmation for April 2026 (deduped by `gmail_thread_id`, excluding `cancelled` and `is_test`):
- `resolved`: 50
- `awaiting_context`: 6
- `active`: 1
- `awaiting_customer`: 1
- `awaiting_support`: 1

(UI shows 41 vs 59 because of the additional internal-only-emails filter, but the ratio is the same.)

## Root cause

`src/pages/Stats.tsx` line 590:
```ts
const gmailOpen = filteredGmailThreads.filter((g) => g.status === "open").length;
```

This is a literal match on `"open"` only, so any thread parked in an in-progress state is silently dropped from both "Resolved" and "Open" — the two tiles don't add up to "Received".

## Fix

Define "Open" as **anything not resolved** (mirroring how Slack does it on line 566: `open = total - resolved`):

```ts
const gmailOpen = gmailTotal - gmailResolvedCount;
```

This is one line change. After it, Resolved + Open == Received always.

### Out of scope

- No changes to the Gmail status machine or `auto_close_gmail_threads` cron.
- No changes to Slack/Manual/Intercom cards.
- No new tiles (e.g., a separate "In progress" breakdown). If you want that later, easy follow-up.

### Files

- `src/pages/Stats.tsx` (line 590)
