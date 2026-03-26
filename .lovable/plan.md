

## Fix Unresolved Slack Channel Names

### Root Causes

1. **Edge function crash**: Line 167 of `list-slack-channels` does `a.name.localeCompare(b.name)` — if any channel object has `undefined` name (e.g. DMs with `D`-prefix IDs), the function throws a 500 error and returns nothing, causing ALL channel names to fail resolution.

2. **DMs have no `name` field**: `D`-prefixed IDs are direct messages. Slack's `conversations.info` returns them without a `name` property, only user IDs.

3. **Private channels not accessible**: Some `C`-prefixed channels may be private channels the bot isn't a member of, so all 3 resolution tiers fail.

### Changes

**1. Fix edge function crash (`supabase/functions/list-slack-channels/index.ts`)**

- Guard the sort: `allChannels.sort((a, b) => (a.name || "").localeCompare(b.name || ""))`
- For DMs resolved via `conversations.info`, set `name` to the DM user's display name (via `conversations.info` response's `user` field + `users.info` lookup), or fall back to `"DM"` as a label

**2. Add missing channel IDs to overrides (`src/lib/channelOverrides.ts`)**

After fixing the crash, re-test the edge function to see which IDs now resolve. For any that still can't be resolved (private channels the bot can't access), add manual overrides. I'll need you to provide the names for any IDs that remain unresolved after the fix.

**3. Handle DM display in both UI pages**

In `Conversations.tsx` and `Stats.tsx`, when displaying a channel name, if the ID starts with `D` and has no resolved name, show "Direct Message" instead of the raw ID.

### Summary
- 1 edge function fix (null-safe sort + DM handling)
- 1 overrides file update (after identifying remaining unresolved IDs)
- 2 UI files updated (DM fallback display)
- Deploy edge function

