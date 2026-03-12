

## Fix: Eyes emoji not appearing on original message

**Problem**: The `addReaction` helper calls Slack's `reactions.add` API but doesn't check or log the response. The call may be returning an error (e.g., `not_in_channel`, wrong timestamp) that's silently ignored.

**Root cause**: The current `addReaction` only catches network-level exceptions. It doesn't inspect the Slack API response body (which returns `{ ok: false, error: "..." }` on failure).

### Changes in `supabase/functions/slack-interactions/index.ts`

Update the `addReaction` helper (lines 13-23) to log the Slack API response so we can diagnose the issue, and also ensure it works:

```typescript
async function addReaction(token: string, channel: string, timestamp: string, emoji: string) {
  try {
    const res = await fetch(`${SLACK_API_URL}/reactions.add`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Slack reactions.add failed for ${emoji}:`, data.error);
    }
  } catch (e) {
    console.error(`Failed to add reaction ${emoji}:`, e);
  }
}
```

Apply the same fix to the `addReaction` helpers in:
- `supabase/functions/slack-events/index.ts`
- `supabase/functions/intercom-webhook/index.ts`

This will surface the actual Slack error in logs so we can see why the emoji isn't appearing (likely a permissions or parameter issue), and fix accordingly.

