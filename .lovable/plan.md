## Goal

Make the **Top accounts** section on the Report tab use a consistent, source-aware account identity so the same customer collapses correctly across rows.

## Current behaviour

`useMonthData` already sets `customer_key` per ticket, but the Intercom case is weak:
- **Slack-routed** rows (`conversation_mappings`) → `channel:<slack_channel_id>` ✓
- **Gmail-routed** rows → email domain via `accountFromEmail` ✓ (Gmail rows are also already deduped per `gmail_thread_id` in the hook, so this is "threads by customer")
- **Manual / Intercom-only** rows (`manual_conversations` with `intercom_conversation_id`, `source='intercom'`) → falls back to `manual:other` or "Personal email" buckets when `contact_name` is a person name rather than an email.

Sample data shows `manual_conversations.contact_name` for `source='intercom'` is most often the requester's email (e.g. `tyler.gettel@checkr.com`, `balazs.k@miro.com`), but sometimes a display name (e.g. `Mohamad Azad`, `Kristina Bodurova`).

## Change

Update the per-ticket account resolution so the Report's **Top accounts** aggregator follows these rules:

| Display source | Bucket key | Label |
|---|---|---|
| Slack (incl. Slack→Intercom mirrors) | `channel:<id>` (resolved to `#name`) | `#channel-name` |
| Gmail | `domain:<host>` from `from_email` | `host` (or "Personal email" for free providers) |
| Intercom (manual rows, no Slack origin) | `domain:<host>` from email parsed out of `contact_name` | `host` |
| Intercom with no parseable email | `intercom:contact:<name>` | the contact name as-is (so each named person stays distinct instead of collapsing into "Manual / other") |
| Other manual sources (slack_dm, slack_thread, teams without channel link) | unchanged from today | unchanged |

This keeps the three buckets the user named — Slack channels, Gmail domains, Intercom creator domains — and makes Intercom-only tickets aggregate at the company-domain level (e.g. all `*@mckinsey.com` tickets land under one row) instead of being scattered.

## Where the change lives

Frontend only, presentation logic:

- **`src/pages/insights/useMonthData.ts`** — in the `manual_conversations` loop, when `m.source === 'intercom'` (or when there's an `intercom_conversation_id` and no Slack channel link):
  - Run `extractEmail(m.contact_name)` first.
  - If found → `accountFromEmail` (already handles personal-domain bucketing).
  - Else → set `customer_key = 'intercom:contact:' + nameSlug`, `customer_label = m.contact_name || 'Intercom contact'`, `customer_kind = 'manual'`.
- **`src/pages/insights/ReportTab.tsx`** — no aggregation changes needed; it already groups by `customer_key` and resolves Slack channel names. Just verify the Top accounts table reads cleanly with the new keys.
- **`src/pages/insights/CustomersTab.tsx`** — automatically benefits from the same hook change (consistent with the Report).

No DB changes, no edge-function changes, no new fetches to Intercom.

## Out of scope

- Looking up Intercom contact emails from Intercom API for Slack-originated cases (those stay channel-attributed, per the user's instruction).
- Changing how Slack channel names are resolved (already done via `list-slack-channels`).

## Verification

1. Open Insights → Report for April / May.
2. In **Top accounts**, confirm: Slack channels show as `#channel-name`, Gmail customers as their domain, Intercom-originated companies (e.g. `mckinsey.com`) collapse into a single row with the right count.
3. Check **Customers** tab uses the same labels (consistency).
