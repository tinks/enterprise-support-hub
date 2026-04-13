

## Show names instead of Slack IDs everywhere

### Problem
1. The **ConversationDetail** page calls `list-slack-users` without `include_deactivated: true`, so guest and deactivated users still show as raw IDs.
2. Both pages rely on the Slack API at runtime to resolve names. If a user is fully removed from the workspace, their name can never be resolved.

### Changes

**1. Fix ConversationDetail lookup** (`src/pages/ConversationDetail.tsx` ~line 339)
- Pass `{ body: { include_deactivated: true } }` to the `list-slack-users` invoke call, matching what `Conversations.tsx` already does.

**2. Cache Slack user names on import** (`supabase/functions/import-slack-thread/index.ts`)
- After fetching the parent message, resolve the Slack user's display name via `users.info` API call.
- Store it in a new `slack_user_name` column on `conversation_mappings` during insert/update.

**3. Add `slack_user_name` column** (migration)
```sql
ALTER TABLE conversation_mappings
  ADD COLUMN slack_user_name text DEFAULT NULL;
```

**4. Backfill existing records** (one-time edge function or script)
- Create a temporary script that:
  - Fetches all distinct `slack_user_id` values from `conversation_mappings`
  - Calls Slack `users.info` for each to get `display_name` / `real_name`
  - Updates `conversation_mappings` rows with the resolved name

**5. Update display logic** (`src/pages/Conversations.tsx` ~line 972, `src/pages/ConversationDetail.tsx` ~line 625)
- Prefer `m.slack_user_name` from the DB, fall back to `userNames[m.slack_user_id]` (runtime lookup), then fall back to the raw ID.

**6. Update the `slack-events` function** to also store the user name when creating new mappings (if it creates mappings).

**7. Update Flow diagram** to reflect that `import-slack-thread` and `slack-events` now cache user display names.

### Files to edit
- `supabase/functions/import-slack-thread/index.ts` — resolve + store user name
- `src/pages/Conversations.tsx` — prefer cached name
- `src/pages/ConversationDetail.tsx` — pass `include_deactivated: true` + prefer cached name
- `src/pages/FlowDiagram.tsx` — update relevant node descriptions
- New migration — add `slack_user_name` column
- Backfill script (run once via edge function invocation)

