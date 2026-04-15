

## Fix: Exclude Sam from poller admin searches to prevent timeout

### Problem
The poller searches by `admin_assignee_id` for every admin in the `admin_owner_map`, including Sam (9520895). Sam is the AI agent who assigns conversations to the enterprise inbox and then unassigns himself — he has hundreds of conversations in a 48-hour window. Paginating through all of them causes the edge function to time out before it can process anything.

### Solution
Exclude Sam's admin ID from the poller's per-admin search queries. Sam's conversations reach the enterprise inbox via `team_assignee_id`, which is already covered by the first search query. Only Joel and Kristina need the `admin_assignee_id` fallback.

Two approaches — I recommend option B:

**Option A — Hardcode Sam's exclusion**: Skip `9520895` in the poller. Fragile if admin IDs change.

**Option B — Add an "exclude from polling" flag**: Instead of searching by every admin in the map, add a setting or convention. The simplest approach: in the poller, filter the admin list to exclude the `intercom_assignee_id` (which is already configured as Sam's ID in settings). This is already available — no new columns needed.

### Changes

**File: `supabase/functions/poll-intercom-inbox/index.ts`**
- After building `adminIds` from `adminOwnerMap`, filter out `settings.intercom_assignee_id` (Sam's ID) since his conversations are captured via `team_assignee_id`
- Add a log line noting which admins are being searched
- Also add `MAX_PAGES_PER_QUERY = 3` as a safety cap on pagination to prevent future timeouts

**File: `src/pages/FlowDiagram.tsx`**
- Update poller node description to note that the bot admin is excluded from per-admin searches

### Technical detail
```text
Current: search by admin_assignee_id for [9520895, 9852095, 9985999]
  → 9520895 (Sam) returns 300+ results → timeout

Fixed: filter out intercom_assignee_id (9520895)
  → search by admin_assignee_id for [9852095, 9985999] only
  → Sam's conversations found via team_assignee_id search
```

### Files to edit
- `supabase/functions/poll-intercom-inbox/index.ts` — filter out bot admin + add pagination cap
- `src/pages/FlowDiagram.tsx` — update documentation

