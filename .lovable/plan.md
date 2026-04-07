

## Fix: Stop filtering out admin messages in Intercom import

### Problem
Joel's message (a real admin reply) is being excluded during import. The current code uses a blocklist of `part_type` values to skip, which includes `"note"`. In Intercom's API, some admin replies — especially internal-facing ones — may be tagged with unexpected `part_type` values, causing legitimate messages to be dropped.

### Root cause
Line 165 filters by `part_type` using a blocklist. This is fragile — if Intercom labels an admin reply with a type we didn't anticipate, it gets silently dropped. The safer approach is to flip to an **allowlist** or remove the `part_type` filter entirely and rely only on: (1) has body content, (2) not a bot author, (3) not a pure system event.

### Solution

**`supabase/functions/import-intercom-ticket/index.ts`**

1. **Replace blocklist with minimal system-event filter** — Only skip parts that are purely operational (no message content): `assignment`, `open`, `close`, `away_mode_assignment`. Remove `"note"` from the skip set entirely.

2. **Add debug logging** — Log each part's `part_type`, `author.type`, and `author.name` before filtering, so future issues are diagnosable from edge function logs.

```text
Before:
  SKIP_PART_TYPES = ["note", "assignment", "open", "close", "away_mode_assignment"]
  + skip if author.type === "bot"

After:
  SKIP_PART_TYPES = ["assignment", "open", "close", "away_mode_assignment"]
  + skip if author.type === "bot"
  + log each part's metadata for debugging
```

This ensures all human messages (admin replies, notes with actual content, email replies) are included. Bot messages and system events remain filtered.

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`

