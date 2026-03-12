

## Revert to username/icon_url overrides

Restore the previous behavior where messages are posted with `username` and `icon_url` overrides (e.g., "Sam APP" with the Intercom admin's avatar), instead of the inline attribution approach.

### Changes in `supabase/functions/intercom-webhook/index.ts`

1. **Remove inline attribution** (lines 277-281) — delete the block that prepends `*🧑‍💼 @user replied:*`

2. **Restore `username` and `icon_url` in `basePayload`** (lines 272-275) — add back the admin name and avatar lookup:
   - For all replies, set `username: adminName` (e.g. "Sam")
   - Look up the Intercom admin's avatar URL from the webhook payload and set `icon_url`

3. **Fetch admin avatar from Intercom author data** — the webhook payload's `lastPart.author` may include an avatar; if not, fetch it from the Intercom API using the admin ID

The result: messages appear as "Sam APP" with the admin's profile picture, exactly as shown in the second screenshot.

