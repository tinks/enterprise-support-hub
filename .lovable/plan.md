

## Handle spam/repeated mentions gracefully

### Problem
The screenshot shows a user repeatedly tagging @Ask Lovable, causing a flood of duplicate "Sam is writing a response..." messages and potentially multiple Intercom tickets for the same question.

Two distinct spam vectors need handling:

1. **Repeated `app_mention` in the same channel** — Each mention gets a unique `event.ts`, so `threadTs = event.ts` is different each time, bypassing the existing dedup check. Multiple conversation mappings and context prompts are created.

2. **Repeated thread replies in `active` threads** — Every human reply posts a new "⏳ Sam is writing..." notice with no dedup, flooding the thread.

### Changes to `supabase/functions/slack-events/index.ts`

**1. Rate-limit app_mention per user per channel**

Before the existing dedup check (line 212), add a query to check if this user already has a recent `conversation_mapping` in this channel within the last 60 seconds:

```typescript
// Check for recent mapping from same user in same channel (spam guard)
const { data: recentMapping } = await supabase
  .from("conversation_mappings")
  .select("id, created_at")
  .eq("slack_channel_id", channelId)
  .eq("slack_user_id", slackUserId)
  .gte("created_at", new Date(Date.now() - 60_000).toISOString())
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (recentMapping) {
  console.log(`Spam guard: ignoring duplicate mention from ${slackUserId} in ${channelId}`);
  return new Response(JSON.stringify({ ok: true }), { ... });
}
```

This silently drops rapid-fire mentions from the same user. The 60-second window prevents legitimate follow-ups from being blocked.

**2. Deduplicate "Sam is writing..." notices in active threads**

In the `message` handler's `active` status block (line 406), before posting "Sam is writing...", check the thread for an existing unresolved notice by scanning recent bot messages:

```typescript
// Check if "Sam is writing..." was already posted recently
const existingNotice = repliesData.messages?.find(
  (m: any) =>
    m.bot_id &&
    m.text?.includes("Sam is writing") &&
    (Date.now() / 1000 - parseFloat(m.ts)) < 120
);

if (!existingNotice) {
  await fetch(`${SLACK_API_URL}/chat.postMessage`, { ... });
}
```

This reuses the thread replies already fetched for button cleanup, so no extra API call is needed.

**3. Same dedup for `escalated` status block**

Apply the identical check before the "reply forwarded" notice in the escalated block (~line 460) to prevent duplicate forwarding notices.

### Flow diagram
No changes needed — this is internal spam handling, not a flow step.

