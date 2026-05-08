## Problem

When a customer submits the optional CSAT remark in Slack, it's saved to `conversation_mappings.csat_remark` but never surfaced anywhere visible — not in the Slack thread, not in Intercom, and not in the messages timeline of the Conversation Detail page. It only appears in the small CSAT side card.

## Fix

In `supabase/functions/slack-interactions/index.ts`, extend the `csat_remark_modal` view_submission handler so that, after persisting the remark, it also:

1. **Posts back into the Slack thread** as a bot message:
   > 💬 Customer remark on rating: "{remark}"
   
   Uses `chat.postMessage` with `channel = original slack_channel_id`, `thread_ts = original slack_thread_ts` (looked up via `mappingId`), and `BOT_IDENTITY`.

2. **Adds an internal note in Intercom** on the linked conversation:
   > CSAT remark ({rating}/5): {remark}
   
   Uses `POST /conversations/{intercom_conversation_id}/reply` with `message_type: "note"`, `type: "admin"`, `admin_id: settings.intercom_assignee_id`. Skipped silently if `intercom_conversation_id` is missing.

Both calls are best-effort and wrapped in try/catch so a failure in one doesn't block the other or the modal close.

## Conversation Detail timeline

In `src/pages/ConversationDetail.tsx`, render a synthetic timeline entry in the messages list when `csat_rating` is set:

- Timestamp = `csat_rated_at`
- Author label = "Customer satisfaction"
- Body = emoji + `{rating}/5` + remark in quotes (when present)
- Styled as a distinct system/event row (similar to existing internal-note styling) so it's chronologically discoverable, not just in the side card.

The existing CSAT side card stays as a quick-glance summary.

## Out of scope

- Backfilling Slack thread / Intercom note for the existing rating on conversation `9fdc6d73…` (rating already in DB). Can be a one-off if requested.
- Gmail/manual CSAT remark display (Slack scope only per existing design).

## Files touched

- `supabase/functions/slack-interactions/index.ts` — extend remark modal handler
- `src/pages/ConversationDetail.tsx` — render CSAT entry in the message timeline
- `.lovable/project-knowledge.md` and `mem://features/csat` — document the new surfacing behavior
