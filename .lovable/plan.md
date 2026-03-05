

# Why Polling Returned 0 Results + Channel Browser

## Root Cause
The edge function logs show:
```
Slack history not ok for joel-lovable-test: { ok: false, error: "channel_not_found" }
```

You entered the channel **name** (`joel-lovable-test`) in the settings, but the Slack API requires the **channel ID** (e.g. `C08XXXXXXXX`). That's why polling finds nothing.

## Plan

### 1. Create a `list-slack-channels` edge function
A new edge function that calls `conversations.list` via the Slack connector gateway. Returns channel names and IDs so you can pick the right one.

### 2. Add a channel browser to the settings UI
- Add a "Browse Channels" button next to the Monitored Channels input
- Opens a dialog/popover listing available Slack channels (name + ID)
- Clicking a channel copies its ID into the input field
- This eliminates the guesswork of finding channel IDs

### 3. Add a "Lookup User ID" button
- Similarly, add a button that calls `users.lookupByEmail` or `users.list` via the gateway
- Shows user display names + IDs so you can find your own Slack user ID to put in the "Slack User ID to Monitor" field
- Currently you have `U091GANMA2U` configured -- this may be correct, but we should verify

### Changes
- **New file**: `supabase/functions/list-slack-channels/index.ts` -- calls `conversations.list` via gateway, returns `{id, name}[]`
- **New file**: `supabase/functions/list-slack-users/index.ts` -- calls `users.list` via gateway, returns `{id, name, real_name}[]`
- **Edit**: `src/pages/Index.tsx` -- add "Browse Channels" and "Lookup Users" buttons with dialogs showing selectable lists

Once you pick the correct channel ID from the browser and save it, Poll Now should work.

