

## Add custom Slack URL override per row on test review page

### Problem
Currently, re-import always constructs the Slack URL from the existing `slack_channel_id` and `slack_thread_ts`. Some conversations may need to be re-imported using a different Slack thread URL (e.g. the correct thread in a different channel).

### Solution

**`src/pages/TestChannelReview.tsx`**

- Add a `customUrls` state map (`Record<string, string>`) keyed by row ID
- Add a small text input (or an edit icon that reveals an input) in each table row where the user can paste a custom Slack thread URL
- When re-importing, if `customUrls[row.id]` is set, use that URL instead of the auto-constructed one
- The input should show a placeholder like "Custom Slack URL" and be compact (inline in the row or in a popover)
- Clear the custom URL for a row after successful re-import

### Files to edit
- `src/pages/TestChannelReview.tsx`

