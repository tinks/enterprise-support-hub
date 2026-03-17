

## Troubleshooting Findings

### Bug 1: Buttons fail the first time
**Root cause:** The `slack-interactions` function makes a synchronous `auth.test` API call (identity guard) before processing any interaction. Combined with `deletePromptMessage` and `views.open` calls, this can exceed Slack's 3-second timeout for interaction responses. On the first click, the edge function is cold-booting (~30ms) + making 3 sequential network calls. Slack shows an error. The second click succeeds because the function is warm and faster.

**Fix:** Cache the identity guard result using a module-level variable so the `auth.test` call only happens once per isolate boot, not on every request. Additionally, for the `add_details` action, move `deletePromptMessage` to run in the background (after returning 200) since it's not needed before opening the modal.

### Bug 2: Sam sent two messages
**Root cause:** The `REPLY_TOPICS` array in `intercom-webhook` includes both `conversation.admin.replied` AND `conversation.admin.single.reply`. Intercom fires both events for the same reply, and there's no deduplication — both trigger a full Slack post, resulting in duplicate messages.

**Fix:** Add deduplication to `intercom-webhook` by tracking the last processed Intercom conversation part ID. Before posting to Slack, check if this part was already processed by storing `last_intercom_part_id` on the mapping and doing an atomic conditional update.

## Changes

### 1. Fix `supabase/functions/slack-interactions/index.ts`
- Add a module-level cache for the identity guard result (bot user ID verified once per isolate)
- Move `deletePromptMessage` in the `add_details` handler to run AFTER returning the 200 response (via `waitUntil`), so the modal opens faster
- Keep `views.open` before the return since Slack needs it to display the modal, but the identity guard cache removes one network call

### 2. Fix `supabase/functions/intercom-webhook/index.ts`
- Add deduplication using the last conversation part's `id` field from the Intercom payload
- Before posting to Slack, do an atomic conditional update: `UPDATE conversation_mappings SET last_intercom_part_id = :partId WHERE id = :id AND (last_intercom_part_id IS NULL OR last_intercom_part_id != :partId)`
- If no rows updated, skip (already processed)

### 3. Database migration
- Add `last_intercom_part_id text` column to `conversation_mappings` table (nullable, no default)

