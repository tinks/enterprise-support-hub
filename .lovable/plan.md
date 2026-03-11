

## Plan: Change thumbs-up to unassign and close

### Change

In `supabase/functions/slack-interactions/index.ts` (lines 448-478), replace the current "assign to admin 8430778 then close" logic with:

1. **Unassign** the conversation using Intercom's assignment API with `assignee_id: "0"` (Intercom's convention for unassigned)
2. **Close** the conversation using `admin_id: "0"` or fetching the settings assignee ID just for the close call

Actually, Intercom requires a valid `admin_id` to close a conversation. We need to keep using a real admin ID for the close action but can set `assignee_id: "0"` to unassign first — or simply skip the assignment step entirely and just close with the settings-based admin ID.

**Simplest approach**: Remove the assignment step, and close using the `intercom_assignee_id` from the settings table (which is already fetched elsewhere in the function). This leaves the ticket unassigned and closed.

### File: `supabase/functions/slack-interactions/index.ts`

- Lines 448-463: Remove the assignment API call entirely
- Lines 465-478: Change `admin_id` from hardcoded `"8430778"` to the assignee ID from settings (call `getSettings(supabase)` which already exists in this file)
- This results in: no reassignment + close = unassigned & closed

