---
name: Manual account normalization
description: Normalise manual_conversations.contact_name into account keys for Top accounts rollup; alias map for McKinsey, Lovable internal, etc.
type: feature
---

`src/pages/insights/manualAccounts.ts` exports `normalizeManualContact(contact_name)` returning `{ key, label }`. Resolution order:

1. **Email in contact_name** → `accountFromEmail` domain bucket (skipped if personal/unknown).
2. **Alias map** (case-insensitive, exact match) — current entries:
   - `mckinsey`, `sergey gorchichko-wroc` → `account:mckinsey` ("McKinsey")
   - `lovable support`, `lovable` → `account:lovable_internal`
   - `zendesk` → `account:zendesk`
3. **Fallback** → `contact:<lowercased name>`.

`INTERNAL_MANUAL_KEYS = { "account:lovable_internal", "domain:lovable.dev" }` — filtered out from the Top manual contacts panel (mirrors the Top accounts filter rule for lovable.dev internal traffic).

**Wired into**: `useMonthData.ts` manual branch (replaces previous email-only fallback). Manual rows now get `customer_kind = "domain"` when the normaliser returns a `domain:` key, otherwise `"manual"`.

**Surfaced in**: `ReportTab.tsx` Top accounts card — third mini-table `Manual contacts` keyed off `stats.manualAccounts`. Generic `manual:slack` / `manual:other` placeholder buckets are excluded.

**How to extend**: add new lowercased keys to `ALIAS_MAP`. For new internal-only accounts, also add their key to `INTERNAL_MANUAL_KEYS`.
