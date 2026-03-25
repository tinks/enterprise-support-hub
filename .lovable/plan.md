

## Use Dedicated "cancelled" Status Instead of "resolved"

### Problem
Cancelled requests currently set `status = "resolved"`, making them indistinguishable from actual resolved conversations in the stats page. They should not appear in stats at all.

### Changes

**1. `supabase/functions/slack-interactions/index.ts` (line 1156)**
Change the cancel handler to set `status: "cancelled"` instead of `status: "resolved"`.

**2. `src/pages/Stats.tsx`**
Filter out rows with `status === "cancelled"` from the fetched data before computing any statistics, so cancelled requests are completely excluded from all charts and summary cards.

**3. `src/pages/Conversations.tsx`**
Add `"cancelled"` to the `statusColor` function so it renders with an appropriate badge color (e.g., gray).

**4. `supabase/functions/context-reminder/index.ts`**
No change needed — the existing query filters on `status = 'awaiting_context'`, so cancelled conversations are already excluded.

### Summary
- Two edge function lines changed (status value)
- Two UI files updated (filter in Stats, badge color in Conversations)
- No database migration needed — `status` is a plain text column

