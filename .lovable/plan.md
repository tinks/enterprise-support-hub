## Goal

Surface a third "Top accounts" mini-table on **Insights → Report** that aggregates `manual_conversations` rows by **normalised account**, so multi-variant contacts like McKinsey (8 "McKinsey" + 6 `*@mckinsey.com` + known contractors) roll up into a single row instead of fragmenting across 8+ buckets.

Scope is read-only: no schema changes, no edits to the Manual log form, no backfill. Pure aggregation logic + UI panel.

## What ships

### 1. Normalisation helper (`src/pages/insights/manualAccounts.ts`, new)

Single pure function `normalizeManualContact(contactName: string): { key: string; label: string }` that runs in this order:

1. **Email in contact_name** → extract domain, run through existing `accountFromEmail` (already filters personal domains & lovable.dev — see `useMonthData.ts:50`). Returns `{ key: "domain:mckinsey.com", label: "mckinsey.com" }`.
2. **Alias map lookup** (case-insensitive, exact match on trimmed name) → maps known free-text labels to a canonical key. Seeded from the April data:
   - `McKinsey`, `Sergey Gorchichko-WROC`, `pulkit_agarwal@mckinsey.com` → `account:mckinsey`
   - `Lovable Support`, `Lovable`, `enterprise-support@lovable.dev`, `joel@lovable.dev`, `kristina@…`, `diana@…`, `jeff@…`, `monica@…`, `fadi@…`, `dan@…` → `account:lovable_internal` (will be filtered out, same as existing top-accounts filter)
   - `Zendesk` → `account:zendesk`
   - `McKinsey` etc. (full alias seed kept in the file, easy to extend)
3. **Fallback** → `{ key: "contact:" + lowercased name, label: original name }`.

Also exports `INTERNAL_KEYS = new Set(["account:lovable_internal", "domain:lovable.dev"])` so the panel can hide internal traffic, mirroring the existing **Top accounts filter** memory rule.

### 2. Wire normalisation into `useMonthData.ts`

In the `manual_conversations` branch (lines ~178-201), when no Slack channel ID and no extractable email is found, call `normalizeManualContact(m.contact_name)` instead of falling back to the generic `"manual:" + source` key. Also call it when the email path produces a personal/unknown bucket so contractor names still roll up.

`customer_kind` becomes `"manual"` for these rolled-up rows; existing email-domain path keeps `kind = "domain"` so they continue to land in the Gmail+Intercom column.

### 3. New mini-table on `ReportTab.tsx`

In the existing Top accounts grid (line 365-374), change from 2 columns to **3 columns** on `lg:` breakpoint:

```text
[ Slack ]   [ Gmail + Intercom ]   [ Manual contacts ]
```

`stats.manualAccounts` is built in the same `useMemo` as `slackAccounts` / `emailAccounts` (around line 576). Aggregation rules:

- Iterate same ticket list.
- Include only tickets where `customer_kind === "manual"` AND the resolved key is **not** in `INTERNAL_KEYS`.
- Same sort (count desc, top 10), same `AccountMiniTable` component — zero new UI primitives.

Also update the `topAccount` highlight (line 209, 616) to consider `manualAccounts` so "Most active account" can be McKinsey when applicable.

### 4. PDF export

No changes needed — the new card is a child of `reportRef`, so the per-section pagination logic added previously will pick it up automatically.

### 5. Project knowledge

Append a one-liner to `.lovable/project-knowledge.md` and add a new memory file `mem://logic/manual-account-normalization` describing the alias map + where to extend it. Update `mem://index.md`.

## Out of scope

- No new column on `manual_conversations`.
- No edit to the manual log form on `/import`.
- No retroactive UPDATE of existing rows.
- No change to **Conversations** table or detail page (still show raw `contact_name`).
- No change to Slack/Gmail/Intercom routing.

## Files touched

- `src/pages/insights/manualAccounts.ts` (new)
- `src/pages/insights/useMonthData.ts` (manual branch normalisation)
- `src/pages/insights/ReportTab.tsx` (3-column grid + `manualAccounts` aggregation + highlight)
- `.lovable/project-knowledge.md` (append note)
- `mem://logic/manual-account-normalization` (new) + `mem://index.md` (add reference)
