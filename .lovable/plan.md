## Add Slack channel notification for new tickets (with surfaced failure logging)

In `supabase/functions/slack-interactions/index.ts`, after the existing group DM to `U0AFU714807` / `U091GANMA2U` posts successfully on new ticket creation, also post the same message body to channel `C0BDZAY8R8A` via `chat.postMessage`.

### Behavior
- Same trigger: every new ticket creation (matches existing DM).
- Same message body (verbatim — Slack thread link + Intercom conversation link).
- Wrapped in its own try/catch so a channel-post failure cannot break ticket creation or the DM path.
- Uses existing `SLACK_BOT_TOKEN` secret — no new secrets, no schema changes.

### Failure surfacing (the one-time check)
- On the `chat.postMessage` response, inspect `data.ok`.
- If `ok === false`, log a clear, distinguishable error line, e.g.:
  `console.error("[ticket-channel-notify] chat.postMessage to C0BDZAY8R8A failed:", data.error, "— if 'not_in_channel', run /invite @<bot> in #channel")`
- Also log on network/throw failures with the same prefix so it's greppable in edge function logs.
- No retry, no persistence — single attempt per ticket, single log line. Easy to find via the `[ticket-channel-notify]` prefix.

### Channel ID
- Stored as a `const TICKET_NOTIFY_CHANNEL_ID = "C0BDZAY8R8A"` at the top of the notification block for easy future edits.

### Maintenance updates (per project standing rule)
- `.lovable/project-knowledge.md` — note the new channel notification alongside the DM.
- Flow page node for ticket creation — add "+ channel post to C0BDZAY8R8A".
- Knowledge page Step 15 — update wording to mention both the group DM and the channel post.
- `changelog_entries` — new entry describing the addition.

### Out of scope
- No UI to configure the channel (hardcoded, matching existing DM pattern).
- No change to DM recipients or message format.
- No retries, backoff, or alerting beyond the single log line.
