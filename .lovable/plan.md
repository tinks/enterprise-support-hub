## Goal

Make Top accounts roll **all McKinsey traffic** (and any other multi-domain account) into a single row, regardless of whether the contact was logged as a name, an email, or a contractor variant. Fix three current leaks.

## Three fixes

### 1. Add a `DOMAIN_TO_ACCOUNT` override in `manualAccounts.ts`

Currently the email path returns the raw domain bucket (e.g. `domain:mckinsey.com`). Add a one-line override map applied **after** `accountFromEmail`:

```ts
const DOMAIN_TO_ACCOUNT: Record<string, { key: string; label: string }> = {
  "mckinsey.com": { key: "account:mckinsey", label: "McKinsey" },
};
```

In `normalizeManualContact`, after step 1 (`accountFromEmail`), if the resolved key is `domain:<d>` and `<d>` is in `DOMAIN_TO_ACCOUNT`, swap to the override. This collapses all 6 `*@mckinsey.com` manual rows into the same `account:mckinsey` bucket as `"McKinsey"` and `"Sergey Gorchichko-WROC"`.

### 2. Extend `ALIAS_MAP` for the remaining contractor variants

Add the two stragglers found in April data:

- `pulkit agarwal` → `account:mckinsey`
- `sergey gorchichko` → `account:mckinsey` (variant without "-WROC" suffix)

### 3. Fix the lost-row bug in `useMonthData.ts`

When the email path resolves to a domain (e.g. `Sergey_Gorchichko-WROC@mckinsey.com`), the manual branch sets `kind = "domain"`. In `ReportTab.tsx`, domain rows only land in `emailMap` if `display_source === "gmail" || "intercom"` — manual rows without `intercom_conversation_id` get `display_source = "other"` and are silently dropped from every Top accounts column.

Fix: in `useMonthData.ts` manual branch, after calling `normalizeManualContact`, set `kind = "manual"` whenever the resolved key starts with `account:` (overrides), so those rows always land in the Manual contacts column. Keep `kind = "domain"` only for plain `domain:*` keys (those should still route to Gmail+Intercom when an intercom_conv_id is present, otherwise we need to also include them in manualMap — see below).

Then in `ReportTab.tsx` Top accounts aggregation, add a fallback: any manual-route ticket with `customer_kind === "domain"` AND `display_source === "other"` (i.e., not surfaced in emailMap) should also be aggregated into manualMap so it isn't dropped. Internal/personal exclusions still apply.

### 4. Update "Most active account" highlight

Already includes `manualAccounts` in the spread (done in last change), so once McKinsey rolls up to ~21 it will correctly show as the top account, with `#workday-lovable` (14) second. No code change needed beyond fixes 1-3.

## Verification

After the fix, with April selected:

- **Manual contacts** column row #1 = `McKinsey` with **21** tickets (8 + 4 + 5 + 1 + 1 + 1 + 1).
- **Gmail+Intercom** column no longer shows `mckinsey.com`.
- **Highlights → "Most active account"** = `McKinsey · 21 tickets`.
- `#workday-lovable` stays in the Slack column at 14.

## Files touched

- `src/pages/insights/manualAccounts.ts` — add `DOMAIN_TO_ACCOUNT` map; extend `ALIAS_MAP` with Pulkit Agarwal & Sergey Gorchichko variant.
- `src/pages/insights/useMonthData.ts` — set `kind = "manual"` for `account:*` overrides.
- `src/pages/insights/ReportTab.tsx` — fallback routing of orphaned manual `domain:*` rows into `manualMap`.
- `.lovable/memory/logic/manual-account-normalization.md` — document the new domain override.

## Out of scope

- Gmail-table rows (`gmail_conversations`) from `@mckinsey.com`. These are a separate channel; a future change can apply the same domain override to the Gmail+Intercom column if you want full cross-channel rollup.
- No schema changes, no manual log form changes.
