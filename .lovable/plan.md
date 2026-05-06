## Disable auto-mark employee tests globally

Set `settings.auto_mark_employee_test` to `false` so the slack-events function stops auto-flagging tickets from `@lovable.dev` users as test tickets.

### Change
- Update the single row in the `settings` table: `auto_mark_employee_test = false`.
- No code changes needed — the existing logic in `supabase/functions/slack-events/index.ts` already short-circuits when this flag is off.
- The toggle remains available in the Settings UI so it can be re-enabled later.

### Note
This does not retroactively unmark the existing ticket (`b29a216e-...`). If you want, I can also unmark it as part of the same change — let me know.