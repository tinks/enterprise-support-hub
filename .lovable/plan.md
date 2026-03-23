

## Update Internal Note: "This user" → "This enterprise user"

Two places to update:

1. **Database (`bot_messages` table)** — Update the `internal_note` row to replace "This user" with "This enterprise user"

2. **Code fallback (`supabase/functions/slack-interactions/index.ts`, line 213)** — Same replacement in the hardcoded fallback string

Both are single-word insertions. Redeploy `slack-interactions` after the code change.

