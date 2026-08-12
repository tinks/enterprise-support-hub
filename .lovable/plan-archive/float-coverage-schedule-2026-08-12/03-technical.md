## Technical detail

**New table `public.float_coverage_shifts`** — `slack_user_id`, `display_name`, `starts_on` (date, inclusive), `ends_on` (date, inclusive), `start_time` / `end_time` (time), `time_zone` (IANA, e.g. `America/Los_Angeles`), `active` (bool), plus the standard id / timestamps and an `updated_at` trigger. Admin-write, authenticated-read RLS with grants for `authenticated` and `service_role` (the edge function reads it). No overlap constraint — overlaps are a supported case.

**Resolution in `_shared/new-ticket-alert.ts`.** Before posting, query active shifts where `starts_on <= today <= ends_on` (evaluated per shift's own zone, so a range boundary means local midnight, not UTC), then keep those whose local wall-clock time falls in `[start_time, end_time)`. Deno's `Intl.DateTimeFormat` with `timeZone` gives the local date and time-of-day, which handles DST without a library. A window whose `end_time` is less than its `start_time` is treated as crossing midnight. Matched Slack IDs are unioned with the always-on IDs from `settings.new_ticket_alert_mentions`, de-duplicated, and formatted with the existing mention logic. Zero matches means the existing no-mention line renders — that path already exists and stays byte-identical.

The whole lookup sits inside the current try/catch: a failed shift query logs and degrades to the always-on list rather than blocking the alert. Alerting must never break a sync run.

**New page `src/pages/FloatCoverage.tsx`** at `/float-coverage`, registered in the Admin flyout in `AppLayout.tsx` with `adminOnly: true`, matching how SLA Policy is gated. The person dropdown reads `public.teammates`; since that table has no Slack ID column, this build adds a nullable `slack_user_id` to `teammates` and surfaces it in the existing `AdminMappingCard` editor, so a teammate is mapped once and reused by the picker. A shift can still be saved with a raw Slack ID typed directly for anyone not in the teammates list.

"On call right now" and the timeline are computed client-side from the same matching rule as the edge function. That rule is duplicated in two runtimes (Deno and browser), so it goes in one small shared module with a unit test covering the DST boundary, a midnight-crossing window, and the empty-schedule case — the client preview and the actual ping must not be able to disagree.

**Verification before calling it done:** insert a shift covering the present moment, fire the existing `test-ticket-channel-notify` harness, and confirm the mention renders; then deactivate it, fire again, and confirm the alert posts unmentioned.

**Docs:** `.lovable/project-knowledge.md` via `sync-knowledge-pending`, a `changelog_entries` row, and the FlowDiagram node for the alert path updated to show the shift lookup.
