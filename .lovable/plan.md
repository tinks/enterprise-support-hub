## Goal

Change the **Customers** tab so it groups by **organization/account** (the natural "customer" unit) instead of by individual person:

- **Gmail tickets** → group by **email domain** (e.g. `acme.com`).
- **Slack tickets** (whether in `conversation_mappings` or `manual_conversations` with `source = 'slack'`) → group by **Slack channel name** (e.g. `#acme-support`).
- **Manual / Intercom-only tickets** → group by email domain if the contact is identifiable, otherwise fall back to a single bucket per source.

Other tabs (Topics, Ticket types, Trends, Channels) stay as they are.

## Customer key rules (per ticket)

| Source row | Key |
|---|---|
| `gmail_conversations` | `domain:` + lowercased part of `from_email` after `@`. Strip leading `www.`. |
| `conversation_mappings` (Slack-bridged) | `channel:` + resolved channel name (lowercase). |
| `manual_conversations` with `source = 'slack'` | `channel:` + resolved channel name **if** we can extract the channel ID from `link` (Slack permalinks include `/archives/<CID>/`); otherwise `manual:slack`. |
| `manual_conversations` other | If `contact_name` looks like an email → `domain:` + its domain. Otherwise → `manual:` + `source` (one bucket per import source). |

Display labels:
- `domain:acme.com` → "acme.com"
- `channel:acme-support` → "#acme-support"
- `manual:slack` → "Manual Slack imports"
- `manual:other` → "Manual / DM"

## Channel name resolution

`conversation_mappings.slack_channel_id` and Slack permalinks only contain channel IDs. To turn them into names:

1. Build a `channelNameMap` once per page load by calling the existing `list-slack-channels` edge function (already used by `src/pages/Index.tsx`).
2. Layer the static `channelNameOverrides` map from `src/lib/channelOverrides.ts` on top.
3. If still unresolved → fall back to displaying the raw channel ID prefixed with `#` so nothing is lost.

The map fetch is async; the Customers tab will show its existing loading state until both `useMonthData` and the channel map have resolved.

## UI changes

- Rename column "Customer" → "Account" in the table.
- Show a small **type badge** on each row: `Domain` (Gmail) / `Slack` (channel) / `Manual`.
- Tickets-per-account histogram bucket labels stay the same (1, 2, 3, 4–5, 6–10, 10+) — meaning shifts from "per person" to "per account", which is more useful.
- KPIs become "Unique accounts", "Repeat accounts (≥2 tickets)", "Single-ticket accounts".
- Drawer header: account label + type badge; ticket list unchanged.

## Things to discard

- Aggregating by `from_name`, `slack_user_name`, `contact_name`. These become noise once accounts are grouped.

## Out of scope

- No backfill or storage of resolved domain/channel — purely derived in the client per page load.
- No fuzzy domain → company-name mapping (acme.com stays "acme.com" until you give us an explicit map).
- No changes to the Topics / Ticket types / Trends / Channels tabs.

## Files to change

- `src/pages/insights/useMonthData.ts` — replace `customer_key` / `customer_label` derivation with the rules above. Add a small Slack permalink → channel-ID parser. Export a helper for the account type (`domain` / `slack` / `manual`).
- `src/pages/insights/CustomersTab.tsx` — fetch channel name map (via `list-slack-channels` + `channelNameOverrides`), rename labels, add type badge, re-resolve `customer_label` for Slack rows once the map arrives.
- `.lovable/project-knowledge.md` + memory index — add a short note about account bucketing rule.

## Open question

For Gmail, should we **exclude common personal-email domains** (`gmail.com`, `outlook.com`, `hotmail.com`, `yahoo.com`, `icloud.com`) from being treated as accounts and instead bucket them as a single "Personal email" account? Default plan: **yes**, group all personal-email senders into one "Personal email" bucket so real B2B accounts surface clearly. Say the word if you'd rather keep them per-individual.
