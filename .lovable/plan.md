

## Plan: Move Recent Conversations to its own page with Slack links

### Changes

**1. Create new page `src/pages/Conversations.tsx`**
- Extract the conversation mappings card from `src/pages/Index.tsx` into a dedicated page
- Add a "Slack" column to the table with a link constructed as: `https://lovable-dev.slack.com/archives/{slack_channel_id}/p{slack_thread_ts with dot removed}`
  - The Slack deep-link format converts `1773756229.694609` → `p1773756229694609` (remove the dot)
- Keep the Intercom link column as-is
- Wrap in `AppLayout`

**2. Update `src/pages/Index.tsx`**
- Remove the conversation mappings card and related state/fetching (`mappings`, `statusColor`, the mappings query)

**3. Update `src/components/AppLayout.tsx`**
- Add a "Conversations" nav link between Stats and Settings using a `MessageSquare` icon
- Route: `/conversations`

**4. Update `src/App.tsx`**
- Add route `/conversations` → `Conversations` component
- Nav order: Stats, Conversations, Settings, Flow

### Slack link format
From the example URL `https://lovable-dev.slack.com/archives/C0AJP396C85/p1773756229694609`, the pattern is:
```
https://lovable-dev.slack.com/archives/{channel_id}/p{thread_ts_without_dot}
```

