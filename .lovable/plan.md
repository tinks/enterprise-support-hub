

## Fix: Prevent duplicate ticket creation on double-click

**Problem**: The "Proceed" button can be clicked twice before `removeButtonsFromMessage` completes, causing two Intercom tickets to be created for the same thread.

**Solution**: Add an idempotency guard using the mapping's `status` field. Before creating a ticket, check that the mapping status is still `pending` (not yet processed). Use an atomic update-and-check pattern to prevent race conditions.

### Changes in `supabase/functions/slack-interactions/index.ts`

**1. "Proceed" button handler (~line 390)**: After fetching the mapping, check `mapping.status === 'pending'` before proceeding. Additionally, atomically update the status to `'processing'` and only continue if the update affected a row — this prevents race conditions where two concurrent requests both read `pending`.

**2. Modal submission handler (~line 310)**: Apply the same guard for the `view_submission` path.

**3. `createIntercomTicket` function**: The existing code already sets status to `'active'` at the end — no changes needed there.

```
// Pseudocode for the guard:
const { data: updated } = await supabase
  .from("conversation_mappings")
  .update({ status: "processing" })
  .eq("slack_channel_id", channelId)
  .eq("slack_thread_ts", threadTs)
  .eq("status", "pending")    // only if still pending
  .select()
  .maybeSingle();

if (!updated) return;  // already being processed

await createIntercomTicket({ ... mappingId: updated.id ... });
```

This is a simple, robust fix — the first request wins and flips status to `processing`; the second request's update matches zero rows and exits cleanly.

