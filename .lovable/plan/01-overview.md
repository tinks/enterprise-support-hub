# Triage queue (read-only)

A new page at `/triage`, added to the **Issues** flyout, listing every open Enterprise-Inbox ticket that has no Severity assigned — oldest first, color graded against the 30-minute triage target.

## Refresh rate — confirmed

`sync-v3-open-frequent` runs **every 5 minutes** (`*/5 * * * *`), pulling Intercom conversations whose `updated_at` moved since the last window, plus wide re-sweeps at 06:15 and 18:15 daily and an hourly `reconcile-v3-open`. Assigning a Severity in Intercom bumps `updated_at`, so a newly-triaged ticket drops off this queue within ~5 minutes. The page will state this and show a "data as of" timestamp from the newest `last_synced_at`, plus a manual refresh button — no live feed is implied.

## Population

Open tickets only (Severity is required before close, so a closed ticket without one is out of scope here):

- `lifecycle_status` in `open` / `reopened_after_finalize` (excludes `finalized` and `transferred_out`)
- no Severity in `custom_attributes` (missing, null, or empty string)

Current state in the database: 44 open/reopened tickets, **1** of them without a Severity. The page is built for the steady-state queue, not the current backlog size — an empty state reading "Nothing awaiting triage" will be the normal view.

## Age and color grading

Age is measured from the **SLA clock start** — Enterprise-Inbox team assignment, falling back to Intercom creation — the same anchor the SLA Report uses, so numbers reconcile across surfaces.

Elapsed is counted in **business hours** (Mon-Fri 09:00-24:00 Europe/Berlin, DST-aware, holidays honored), matching the seeded triage target row (`metric='triage'`, `clock='business'`, 1800s). Targets and the business calendar are read from the effective-dated policy config, never hardcoded; if the config fails to load, the existing `PolicyFallbackBanner` shows, as on the other SLA surfaces.

Grade bands, as a percentage of the triage target:

| Band | Business-minutes elapsed | Treatment |
| --- | --- | --- |
| OK | under 50% (0-15 min) | neutral row |
| Approaching | 50-80% (15-24 min) | amber accent |
| At risk | 80-100% (24-30 min) | strong amber |
| Breached | over 100% (30 min+) | destructive accent |

Wall-clock age is shown as a secondary column so an overnight ticket reads honestly: "4m business / 14h elapsed".
