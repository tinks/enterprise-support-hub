
Goal: fix the false-negative mention handling where `@Ask Lovable :sad-panda:` does not create a mapping right after another mention in the same minute.

What’s actually happening
- This is not an emoji parsing bug.
- The app_mention path currently has a 60-second spam guard keyed by `(slack_user_id + channel)`.
- Your two 1:24 PM mentions were in the same channel by the same user within that window, so the second one was intentionally dropped before mapping creation.
- Edge logs already show this exact path: `Spam guard: ignoring duplicate mention...`.

Implementation plan
1. Remove the broad 60-second user/channel spam guard from `supabase/functions/slack-events/index.ts` (app_mention branch).
2. Keep idempotency based on thread identity:
   - retain the existing `(slack_channel_id, slack_thread_ts)` check (and existing unique index) so Slack retries of the same mention still won’t create duplicates.
3. Harden prompt delivery:
   - validate `chat.postMessage` response (`ok === true`) before inserting `conversation_mappings`.
   - if Slack post fails, log the error and skip insert (prevents orphan “awaiting_context” rows with no buttons).
4. Improve observability:
   - add structured logs for app_mention decisions (`accepted`, `already_processed`, `post_failed`) with `channelId/threadTs`.
5. Update flow documentation text in `src/pages/FlowDiagram.tsx` so the diagram no longer suggests per-user cooldown behavior.

Technical details
- File to change: `supabase/functions/slack-events/index.ts`
- Remove block roughly around current lines 253–269 (`recentMapping` query + early return).
- Keep/lean on:
  - existing `existing` mapping lookup (`slack_channel_id + slack_thread_ts`)
  - DB unique index on `(slack_channel_id, slack_thread_ts)` from migrations.
- Add response check for the context prompt `chat.postMessage` (currently fire-and-forget).

Validation plan
1. Send `@Ask Lovable test :sad-panda:` then immediately `@Ask Lovable :sad-panda:` in same channel.
2. Confirm both create rows in Recent Conversations (distinct thread timestamps).
3. Confirm each thread receives the “Add Details / Proceed” prompt.
4. Re-send same exact event via Slack retry scenario and confirm no duplicate mapping for same thread.
