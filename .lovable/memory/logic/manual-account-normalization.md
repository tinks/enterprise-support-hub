---
name: Manual account normalization
description: Normalise manual_conversations.contact_name into account keys for Top accounts rollup; alias map for McKinsey, Lovable internal, etc.
type: feature
---

`src/pages/insights/manualAccounts.ts` exports `normalizeManualContact(contact_name)` returning `{ key, label }`. Resolution order:

1. **Email in contact_name** → `accountFromEmail` domain bucket. If the resolved domain is in `DOMAIN_TO_ACCOUNT` (e.g. `mckinsey.com → account:mckinsey`), swap to that override so emailed McKinsey contacts merge with the alias bucket. Personal/unknown domains fall through.
2. **Alias map** (case-insensitive, exact match) — current entries:
   - `mckinsey`, `sergey gorchichko-wroc`, `sergey gorchichko`, `pulkit agarwal` → `account:mckinsey` ("McKinsey")
   - `lovable support`, `lovable` → `account:lovable_internal`
   - `zendesk` → `account:zendesk`
3. **Fallback** → `contact:<lowercased name>`.

`INTERNAL_MANUAL_KEYS = { "account:lovable_internal", "domain:lovable.dev" }` — filtered out from the Top manual contacts panel (mirrors the Top accounts filter rule for lovable.dev internal traffic).

**Wired into**: `useMonthData.ts` manual branch. `customer_kind = "manual"` whenever the resolved key is `account:*` or `contact:*`; only plain `domain:*` keys (no override) keep `kind = "domain"`.

**Surfaced in**: `ReportTab.tsx` Top accounts card — third mini-table `Manual contacts` keyed off `stats.manualAccounts`. Generic `manual:slack` / `manual:other` placeholder buckets are excluded. **Fallback rule**: any manual-route ticket with `customer_kind = "domain"` that didn't qualify for the Gmail+Intercom column (e.g. `display_source = "other"`) is also routed into `manualMap` so it isn't dropped.

**How to extend**:
- Add a known free-text label or contractor name → `ALIAS_MAP`.
- Add a customer's email domain (when *every* `*@domain` should roll up into one account) → `DOMAIN_TO_ACCOUNT`.
- Add internal-only accounts → `INTERNAL_MANUAL_KEYS`.
