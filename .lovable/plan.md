

## Fix source message timestamp in Intercom import

### Problem
The source message (first message in the conversation) gets timestamped at import time instead of its actual send time. This happens because `icData.source.created_at` doesn't exist in the Intercom API response — the source object doesn't carry its own `created_at`. The conversation's creation timestamp is at `icData.created_at` (top-level), so the code falls through to the `new Date().toISOString()` fallback.

### Fix

**`supabase/functions/import-intercom-ticket/index.ts`**

Line 159 — change the `created_at` for the source message to use the conversation-level timestamp:

```ts
// Before
created_at: src.created_at ? toIso(src.created_at) : new Date().toISOString(),

// After
created_at: src.created_at ? toIso(src.created_at) : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString()),
```

This adds a second fallback: `src.created_at` → `icData.created_at` (conversation creation time) → `now()`. The conversation-level `created_at` matches when the initial message was sent.

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`

