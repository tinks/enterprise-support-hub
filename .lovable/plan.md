

## Include guest users in list-slack-users

### Problem
The `list-slack-users` edge function filters out guest users (single-channel and multi-channel guests) because it skips anyone where `is_bot` is true or `deleted` is true. However, Slack guest users have `is_restricted` or `is_ultra_restricted` set — they aren't bots, so they pass the bot check but may still be missed if other filtering is too aggressive. The real issue found earlier was that the user wasn't in the results at all, suggesting they may be a deactivated guest or the filter is dropping them.

### Change

**File: `supabase/functions/list-slack-users/index.ts`**

Update the filter on ~line 44 to only skip deleted users, bots, and USLACKBOT — but explicitly **include** guest users (`is_restricted` and `is_ultra_restricted`). Add a `is_guest` boolean field to the output so callers can distinguish guests from full members.

Current filter:
```typescript
if (member.deleted || member.is_bot || member.id === "USLACKBOT") continue;
```

No change needed to this line — guests already pass it. The function already includes guests. But to make guest status visible and to also optionally include deactivated users for lookup purposes, add:

1. Add an optional `include_deactivated` query parameter (default false)
2. When `include_deactivated` is true, don't skip `member.deleted`
3. Add `is_guest` and `is_deactivated` fields to the response objects

This ensures users like Emily Ann Clemons (a guest) appear and are identifiable.

### Files to edit
- `supabase/functions/list-slack-users/index.ts`

