

## Plan: Add Testing Mode Toggle

### Database
Add a `testing_mode` boolean column to the `settings` table (default `false`).

### Settings UI (`src/pages/Index.tsx`)
Add a Switch toggle labeled "Testing Mode" with a description like "Show Intercom conversation IDs in Slack messages for debugging". Saves with the rest of the settings.

### Edge Function Changes

When the Intercom conversation is created (`supabase/functions/slack-interactions/index.ts`, around line 167), if `testing_mode` is enabled in settings, post an additional Slack message in the thread showing the Intercom conversation ID (e.g., `🔧 Debug: Intercom conversation ID: {id}`).

Similarly in `supabase/functions/intercom-webhook/index.ts`, when posting replies to Slack, if `testing_mode` is on, prepend a context line with the conversation ID.

### Files to change
1. **Database migration**: Add `testing_mode boolean default false` to `settings`
2. **`src/pages/Index.tsx`**: Add Switch toggle for testing mode in the Configuration card
3. **`supabase/functions/slack-interactions/index.ts`**: After creating the Intercom conversation (~line 167), check `settings.testing_mode` and post a debug message to the Slack thread with the conversation ID
4. **`supabase/functions/intercom-webhook/index.ts`**: When posting replies, fetch settings and if `testing_mode` is true, include the Intercom conversation ID in the Slack message

