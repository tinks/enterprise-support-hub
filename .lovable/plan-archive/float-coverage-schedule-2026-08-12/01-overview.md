# Float coverage schedule

Today the new-ticket Slack alert pings a fixed list of Slack user IDs from the Settings box — the same people at 2AM Sunday as at 2PM Tuesday. This replaces that with a real rotation: named shifts with a date range, a daily time window, and a timezone, so "Aug 1–15, noon–5PM Pacific → Sam" and "Aug 16–25, noon–5PM Pacific → Joel" are rows you edit, not code.

## How the ping is decided

When a new ticket lands, the alert looks at the current moment and collects every shift covering it:

- **Inside one or more shifts** → mention everyone covering. Overlaps are legal and intentional, so a handoff day or a heavy week can carry two people.
- **Outside every shift** → no mention. The alert still posts to `#enterprise-support-tickets` in full; it just doesn't buzz anyone. A 2AM ticket waits in the channel for the next shift rather than waking whoever is nominally on the list.

The existing **New-ticket alert mentions** box stays, repurposed as an always-on list: anyone in it is pinged on every alert regardless of the schedule. Leave it blank — the normal case once shifts exist — and coverage is purely schedule-driven. It is the escape hatch for "page me on everything this week" without touching the rotation.

## Shift shape

Each shift is one row:

| Field | Example | Notes |
| --- | --- | --- |
| Person | Sam | Slack user, picked from a dropdown |
| Start date | 2026-08-01 | Inclusive |
| End date | 2026-08-15 | Inclusive |
| Daily window | 12:00 – 17:00 | Applies every day in the range |
| Timezone | America/Los_Angeles | Per shift, so a Berlin shift and a Pacific shift coexist |
| Active | on | Switch a shift off without deleting it |

The window applies every day in the range, weekends included. To skip a weekend, create two rows. Timezones are real IANA zones evaluated at alert time, so a range spanning a DST change stays at "noon Pacific" on both sides rather than drifting an hour.

## Where it lives

A new **Float coverage** page in the Admin flyout, alongside Customers, Settings, and SLA Policy — admin-gated like SLA Policy. The page holds:

- **On call right now** — a banner naming who is covering this moment, or stating plainly that nobody is and alerts will post unmentioned. This is the answer to "if a ticket came in right now, who gets pinged?" without reading the table.
- **Schedule table** — all shifts, upcoming first, with inline edit and delete.
- **Coverage timeline** — a horizontal strip over the next few weeks showing each person's blocks and, more importantly, the gaps.
- **Add shift** — the row editor.

## Deliberately not in this build

- No sync to Intercom assignment or any paging tool. This decides who gets @-mentioned in Slack, nothing more.
- No recurring-rule engine ("every other Tuesday"). Shifts are explicit date ranges; a repeating rotation is several rows.
- No change to which tickets alert or when. The 5-minute cron, the 24-hour age gate, and the one-alert-per-ticket dedup all stay exactly as they are.
