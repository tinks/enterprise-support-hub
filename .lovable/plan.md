

## Fix: Cache Settings for Slack Interaction Timeout

### Problem
The `getSettings()` DB call on line 438 runs on **every request**, adding ~200-500ms. Combined with the `auth.test` call on cold boot, this exceeds Slack's 3-second limit.

### Changes

**File: `supabase/functions/slack-interactions/index.ts`**

1. **Add module-level settings cache** (next to existing `cachedBotUserId` on line 18):
   - Add `let cachedSettings: { slack_bot_user_id: string; intercom_assignee_id: string; ... } | null = null`

2. **Replace the `getSettings` call in the identity guard** (lines 437-439):
   - If `cachedSettings` is null, call `getSettings()` and store result in `cachedSettings`
   - Otherwise use the cached value
   - This eliminates the DB round-trip on all warm requests

3. **Reorder: read body + verify signature BEFORE identity guard** (swap lines 437-462 with 464-477):
   - Signature verification is purely local (no network), so it should run first
   - This way, invalid requests are rejected cheaply without any network calls
   - The identity guard (which may need `auth.test`) runs only for valid signed requests

4. **Use `cachedSettings` everywhere** `getSettings()` is called later in the handler, avoiding redundant DB queries within the same request.

### What stays the same
- The `cachedBotUserId` cache for `auth.test` (already implemented)
- The background `deletePromptMessage` via `waitUntil` (already implemented)
- All business logic and Intercom integration unchanged

