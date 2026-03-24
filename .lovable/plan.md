

## Fix "Gathering your details…" Freeze on Modal Close Failure

### Problem
When a user clicks "Add Details," the prompt immediately changes to "⏳ Gathering your details…". If they then close the modal without submitting, the `view_closed` handler attempts to create the ticket. If anything in that path fails (e.g., Slack user lookup error for external users), the error is silently caught and the Slack message stays stuck at "Gathering your details…" forever — the user is stranded.

### Root Cause
The `view_closed` catch block (line 929) logs the error but never restores the prompt message or resets the mapping status back to `awaiting_context`.

### Fix — `supabase/functions/slack-interactions/index.ts`

**1. Add error recovery in `view_closed` catch block (line 929)**

When `createIntercomTicket` fails in the `view_closed` path:
- Reset the mapping status back to `awaiting_context`
- Restore the original prompt message with buttons so the user can try again
- Post a short error message in the thread: "Something went wrong — please try again using the buttons above."

**2. Add same error recovery in `view_submission` catch block (line 875)**

Same pattern — if ticket creation fails after modal submit, restore the prompt and reset status.

**3. Add error recovery in `proceed_without_context` catch block (line 1022)**

Same pattern for the "Proceed" button path.

### Technical Detail

Each catch block will:
```typescript
catch (err) {
  console.error("...", err);
  // Reset status so user can retry
  await supabase.from("conversation_mappings")
    .update({ status: "awaiting_context" })
    .eq("slack_channel_id", channelId)
    .eq("slack_thread_ts", threadTs)
    .eq("status", "processing");
  // Restore prompt with buttons
  // (re-post the original prompt message with Add Details / Proceed buttons)
  // Post error notification in thread
}
```

This ensures no conversation gets permanently stuck — users can always retry.

