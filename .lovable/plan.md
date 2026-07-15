Add knowledge about the new `poll-slack-closed-won` edge function to the `/knowledge` page.

## What to add

A new row in the Edge Functions table (§2) of the knowledge doc, alongside the other cron pollers:

> `poll-slack-closed-won` | Daily cron (04:00 UTC): reads the last 2 days of messages from Slack channel `C09CL5E028N` via the "11 - PICK THIS BOT CONNECTION" bot (`SLACK_API_KEY_1`), extracts `Company Name:` / `Company Domain:`, and inserts new rows into `v3_customer_accounts` (dedupe by `domains` + `account_key`).

Plus a short subsection under the cron/scheduled-jobs area noting:
- Cron job name: `poll-slack-closed-won-daily`
- Schedule: `0 4 * * *` (04:00 UTC daily)
- Window: messages with `ts >= now - 2 days`
- `account_key` derivation: lowercase company name → spaces to `_` → strip non-alphanumerics
- Dedup: skips domains already present in `v3_customer_accounts.domains` and account_keys already present
- Inserts stamped with `notes: 'Auto-created from Slack #closed-won'`

## How it lands on /knowledge

The `/knowledge` page renders `knowledge_documents.content` and supports a pending-review flow (`pending_content` + `pending_summary`). Steps:

1. Update `.lovable/project-knowledge.md` with the new row + subsection so the source of truth stays in sync with the workspace rule ("update project-knowledge.md on logic changes").
2. Write the same updated markdown into `knowledge_documents.pending_content` (with a short `pending_summary`) via `supabase--insert`, so it appears as a review diff on `/knowledge` for the user to approve.

No UI or route changes. No new tables. Docs-only.
