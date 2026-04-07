

## Use first user message timestamp for manual conversation dating

### Problem
When importing Intercom conversations, `created_at` defaults to `now()` (the database default), so they appear as today's conversations in analytics. They should be dated based on when the user actually sent their first message.

### Solution

**`supabase/functions/import-intercom-ticket/index.ts`**
- After building the `messages` array and sorting chronologically, extract the timestamp of the earliest message
- Update the `manual_conversations` row's `created_at` to that timestamp (using an UPDATE after insert, or by passing `created_at` in the insert)
- Specifically: set `created_at` to `messages[0].created_at` if messages exist, otherwise use the Intercom conversation's `created_at` field (`toIso(icData.created_at)`)

**`supabase/functions/intercom-webhook/index.ts`**
- In the auto-import-on-assignment handler, apply the same logic: set `created_at` on the inserted `manual_conversations` row to the earliest message timestamp or the Intercom conversation creation time

**`src/components/ManualLogTab.tsx`**
- For manually typed conversations, no change needed — `created_at` at time of entry is correct since these are logged in real time

**`src/pages/FlowDiagram.tsx`**
- Note that imported conversations use first message timestamp for `created_at`

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`
- `supabase/functions/intercom-webhook/index.ts`
- `src/pages/FlowDiagram.tsx`

