# Publish blockers: close the three critical findings

## What the code actually shows right now

I inventoried every edge function before writing this, so the scope is smaller than the roadmap suggests.

**Finding 2 — open data-read functions: already done.** All six named functions plus `search-intercom-by-email` call `requireUser` at the top of the handler: `list-slack-users`, `list-slack-channels`, `fetch-thread-messages`, `fetch-gmail-thread`, `intercom-month-stats`, `check-bot-identity`. Nothing to write here — only re-verification from the UI and a re-scan to confirm the scanner agrees.

**Finding 1 — Gmail OAuth hijack: real and unfixed.** `gmail-auth-url` has no gate at all — anyone can mint a consent URL. `gmail-oauth-callback` takes any `code` with no `state` at all, and on success runs `delete().neq(id, ...)` on `gmail_oauth_tokens` before inserting. So an unauthenticated caller can wipe the Hub's Gmail connection and replace it with their own account's tokens, and poll-gmail then reads their mailbox.

**Finding 3 — open mutation functions: real, and needs classification before any code.** 35 functions carry no gate. They are not one population — grep shows plenty are named in `src/` (health cards, "Run now" buttons) *and* run on cron. Applying `requireEditor` blindly to those breaks the cron caller silently: it returns 403, the job records nothing, and the Hub shows stale data that looks fine.
