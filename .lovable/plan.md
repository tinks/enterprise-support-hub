
Goal: stop the “old bot” loop by making token mismatches impossible to miss and preventing wrong-identity posting.

What I confirmed from your current run
- The identity check endpoint is returning:
  - bot_user_id: `U0AJT4RT36W`
  - bot/display name: `Lovable Support Bot`
  - app_id: `null`
- That means your backend is still authenticating with the old bot token. This is not just Slack composer cache.

Implementation plan
1) Harden backend identity diagnostics
- Upgrade `check-bot-identity` to return richer, safe diagnostics:
  - `token_type_guess` (xoxb/xoxp/xoxa)
  - `auth_user`, `bot_id`, `team_id`, `team_name`
  - `is_bot_token` boolean
  - `is_expected_name` boolean + mismatch reason string
- Add explicit error text for common cases:
  - wrong token type
  - valid token, wrong bot identity
  - missing bot scopes

2) Add a strict “expected bot” guardrail in app settings
- Add an “Expected Bot User ID” setting (readable field in Settings UI).
- When identity check runs, compare `current bot_user_id` vs `expected bot_user_id`.
- Show a clear pass/fail status:
  - green when exact ID match
  - red with “token belongs to different app/bot” when mismatch

3) Prevent silent wrong-brand posting
- In Slack-facing backend functions (`slack-events`, `slack-interactions`, `intercom-webhook`), add a lightweight startup check:
  - call `auth.test` once per invocation
  - if `expected bot_user_id` is configured and does not match, stop processing and log a clear error
- This avoids posting from the wrong bot identity even if a wrong token is accidentally pasted again.

4) Improve the Settings troubleshooting UX
- Update `BotIdentityCard` with:
  - a “Current vs Expected” row
  - token type hint (must be bot token)
  - exact copyable mention: `<@BOT_USER_ID>`
  - concise fix checklist tailored to mismatch cause
- Keep “Re-check” flow as-is for quick verification.

5) Validate end-to-end
- Re-run identity check: must show expected bot ID and name.
- In Slack composer, `@` lookup should resolve to the expected bot.
- Mention bot in monitored channel and verify reply sender identity matches expected bot profile.

Technical implementation notes
- Files to update:
  - `supabase/functions/check-bot-identity/index.ts`
  - `supabase/functions/slack-events/index.ts`
  - `supabase/functions/slack-interactions/index.ts`
  - `supabase/functions/intercom-webhook/index.ts`
  - `src/components/BotIdentityCard.tsx`
  - `src/pages/Index.tsx`
- Data change:
  - add `expected_bot_user_id` on `settings` (single migration).
- No authentication/RLS policy changes needed.

Acceptance criteria
- Identity card shows exact bot ID match (not just name match).
- Any wrong token is blocked with explicit mismatch error.
- Slack mentions and posted bot identity stay aligned after token updates.
