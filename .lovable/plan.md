

## Combine "Recently imported" into a unified section

### What changes
Replace the current "Recently imported" section (which only shows Slack imports without Intercom links) with a unified list pulling the 5 most recent entries across all three tables (`conversation_mappings`, `gmail_conversations`, `manual_conversations`). Each row navigates to the correct detail page with the proper `source` query param, matching inbox behavior.

### Implementation

**`src/components/ImportTab.tsx`**

1. Define a new unified type:
   ```tsx
   interface RecentImport {
     id: string;
     label: string;       // message text or subject
     source: "slack" | "gmail" | "manual";
     status: string;
     created_at: string;
   }
   ```

2. Replace `loadRecentImports` to query all 3 tables, merge, sort by `created_at` desc, take 5:
   - `conversation_mappings`: select id, original_message_text, status, created_at → source "slack"
   - `gmail_conversations`: select id, subject, status, created_at → source "gmail"
   - `manual_conversations`: select id, subject, status, created_at → source "manual"
   - Limit each query to 5, then merge + sort + slice(0, 5)

3. Replace the "Recently imported" card rendering:
   - Title: "Recently imported"
   - Description: "Last 5 imported conversations across all sources"
   - Each row shows: label (truncated), date, source badge, status badge
   - `onClick`: navigate to `/conversations/${item.id}?source=${item.source}` (omit `?source=` for slack since that's the default)
   - Remove the Slack external link icon (no longer source-specific)

4. Remove `buildSlackLink` helper and old `ImportedConversation` interface, replace with `RecentImport[]` state.

5. Call `loadRecentImports()` after successful Slack import and Intercom import (already done for Slack, add for Intercom before the navigate call).

### Files to edit
- `src/components/ImportTab.tsx`

