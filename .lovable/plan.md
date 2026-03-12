
Goal: make the Slack mention identity deterministic so it stops showing the old “Lovable Support Bot” and matches the app you just renamed.

What I found
- Your code already uses `"Ask Lovable"` overrides in backend message posts.
- Your screenshots show Slack App settings are updated (`App name: Ask Lovable`, `Bot display name: Ask Lovable`).
- But Slack composer still suggests `@lovable support...`, which strongly indicates the active bot token/app identity in runtime does not match the app you edited (or Slack is still resolving an older bot identity).

Plan
1) Add a backend “Bot Identity Check” endpoint
- Create a small backend function that calls Slack:
  - `auth.test` (token owner + bot user/app IDs)
  - `users.info` (actual bot profile name/display name)
- Return a compact identity payload (app ID, bot user ID, bot handle, display name, team/workspace).

2) Surface identity in Settings UI
- Add a “Slack Bot Identity” panel in `/settings` showing:
  - Active app ID
  - Active bot user ID
  - Active handle/display name from Slack API
  - Exact mention format: `<@BOT_USER_ID>` (copy button)
- This immediately confirms whether the running token is attached to the app you renamed.

3) Remove bot name spoofing in runtime posts
- In bot-authored `chat.postMessage` calls, remove `username`/`icon_url` overrides so Slack always renders the real bot profile identity.
- Keep custom attribution only where intended (human admin relay messages from Intercom).

4) Add mismatch warning in UI
- If Slack API identity does not contain “Ask Lovable” (or app/user IDs differ from expected), show a warning:
  - “Current token points to a different Slack app/bot identity.”
- Include a one-click instruction checklist in UI:
  - regenerate/recopy bot token from the renamed app
  - update backend secret
  - reinstall app
  - hard refresh Slack client

5) Validate end-to-end
- From UI, run identity check and confirm the active token identity.
- In Slack, type `@` and confirm the suggestion matches returned identity.
- Mention the bot in a monitored channel and verify message sender name + mention identity now align.

Technical details
- Why this is needed: message `username` overrides can change visual sender text, but mention autocomplete comes from the bot user identity tied to the token/app installation.
- No database migration is required for this fix.
- No auth/RLS changes required.
