## Goal

Restructure the Report tab "Top accounts" card so it's split into three clear per-channel sections instead of one mixed list.

## What changes

In `src/pages/insights/ReportTab.tsx`, replace the single Top accounts table with three side-by-side compact lists:

- **Slack** — grouped by Slack channel name (e.g. `#workday-lovable`). Includes Slack-routed Intercom cases (since we don't have the contact email for those — they fall back to channel here).
- **Gmail** — grouped by sender email domain (e.g. `mckinsey.com`), thread-deduped (already done upstream).
- **Intercom** — grouped by contact email domain, using only Intercom cases where the email is known (manual imports, polled inbox cases with `contact_name` containing an email).

Each list shows top 5 by ticket count, compact rows: `Account · Tickets`. Clicking a row expands an inline details panel showing Bugs, FRs, and Avg CSAT for that account.

## Layout

```text
┌─ Top accounts ─────────────────────────────────────────────┐
│  Slack              Gmail              Intercom            │
│  #workday-lovable 14   lovable.dev   93   acme.com    7    │
│  #ext-bts-lovable 12   mckinsey.com   7   foo.com     5    │
│  #team-ent...    11   Personal email 8   ...               │
│  ...               ...               ...                   │
│  ▼ (expanded row)                                          │
│    Bugs 2 · FRs 0 · CSAT 4.5                              │
└────────────────────────────────────────────────────────────┘
```

Brief subtitle under the heading: "Slack by channel · Gmail by email domain · Intercom by contact email domain (Slack-routed Intercom cases counted under Slack)."

## Bucketing rules (per ticket)

| Source           | Account key                                              |
|------------------|----------------------------------------------------------|
| Slack only       | Slack channel name                                       |
| Slack + Intercom | Slack channel name (counted in Slack list)               |
| Gmail            | Email domain from `from_email`                           |
| Manual / Intercom with email | Email domain from `contact_name`             |
| Manual / Slack with channel link | Slack channel (counted in Slack list)    |
| Manual / other (no email, no channel) | Excluded from per-channel lists     |

The "Most active account" highlight bullet uses the max across all three lists.

## Technical notes

- `computeStats` already produces `slackAccounts`, `gmailAccounts`, `intercomAccounts` from a `bucketAccount(kind)` helper that filters by `display_source`. The bucketing change: stop classifying purely by `display_source === "intercom"` for Slack-routed cases — instead, group any ticket whose resolved account key is a Slack channel into the Slack list (regardless of display_source). This keeps `#workday-lovable` Intercom-linked tickets in the Slack column where they're recognizable.
- Add a small expand state per list (`useState<string | null>`) for the click-to-expand row.
- Drop the unused `topAccounts` shape; keep `topAccount` for the highlights bullet.
- No backend / schema changes. Intercom email backfill is intentionally deferred.

## Files touched

- `src/pages/insights/ReportTab.tsx` — restructure Top accounts card + `computeStats` bucketing.
- `.lovable/project-knowledge.md` — note the per-channel grouping rule for the monthly report.
