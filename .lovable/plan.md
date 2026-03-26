

## Stop Slack-originated replies from echoing back

### Problem

When someone replies in a Slack thread, `slack-events` forwards the message to Intercom. Intercom then fires a `conversation.admin.replied` webhook, and `intercom-webhook` posts it right back into the same Slack thread — creating an ugly duplicate (as shown in your screenshot).

### Fix

In `intercom-webhook`, after extracting the reply text body from the Intercom conversation part, check if it contains the `[From: ... via Slack]` attribution prefix that `slack-events` adds. If it does, skip posting to Slack entirely (the message is already there).

### Changes

**1. `supabase/functions/intercom-webhook/index.ts`** (~line 459, after replyText is built)

Add a guard:
```ts
// Skip replies that originated from Slack (they already appear in the thread)
const slackOriginPattern = /\[From:.*via Slack\]/i;
if (slackOriginPattern.test(replyText) || slackOriginPattern.test((lastCommentPart.body as string) || "")) {
  console.log(`Skipping Slack-originated reply for conversation ${conversationId} (already in thread)`);
  return new Response(JSON.stringify({ ok: true, message: "Slack-originated reply skipped" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

**2. Deploy** the updated `intercom-webhook` edge function.

**3. Update Flow diagram** to note this dedup guard.

### What this fixes
- Employee replies in Slack no longer echo back as a second bot message
- Customer replies from Slack (original requester) are unaffected — they don't have the prefix
- Replies genuinely made in Intercom continue to be relayed to Slack as before

