## Verify Slack channel C0BDZAY8R8A is configured for ticket-creation notifications

Goal: confirm `SLACK_BOT_TOKEN` can post to `C0BDZAY8R8A` (i.e. the bot is a member and the channel ID is correct) without creating a real ticket.

### Approach

Add a tiny one-shot test edge function `test-ticket-channel-notify` that:

1. Loads `SLACK_BOT_TOKEN`.
2. Calls `chat.postMessage` to `C0BDZAY8R8A` with a clearly-labeled test payload identical in shape to the real notification, e.g.:
   > 🧪 *Test* — Ticket channel notification check from `slack-interactions` config. Safe to ignore. (timestamp)
3. Returns the raw Slack API response (`ok`, `error`, `channel`, `ts`) plus a friendly diagnosis:
   - `ok: true` → ✅ Channel is configured correctly. Includes the message `ts` so you can find/delete it.
   - `ok: false, error: "not_in_channel"` → ❌ Bot is not a member; run `/invite @<botname>` in the channel.
   - `ok: false, error: "channel_not_found"` → ❌ Channel ID is wrong or private/inaccessible.
   - any other error → returned verbatim with a note.

### Execution

Invoke the function via the edge-function curl tool right after deploy. Report back the Slack response and the diagnosis. No real ticket is created, no DM is sent, no DB rows are touched.

### Cleanup options

After the test, leave the function in place as a future re-test utility, OR delete it. Default: **leave it** (it's harmless and only acts when called). I'll mention both options in the result.

### Out of scope

- No changes to the real `slack-interactions` flow.
- No end-to-end ticket creation — that would require a live Slack mention and produce an Intercom ticket. The chat.postMessage call alone is the only thing that can fail in the new code path I added.
