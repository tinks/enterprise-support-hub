## Add Required Support Action (RSA) field

Bring back RSA on the v3 stack. Tag-derived by default, with a manual override, surfaced on Inbox v3 and filterable on Analytics v3.

### Definition

`rsa = true` (Required) unless one of:
- `rsa_override` is explicitly set (`true` / `false`), OR
- Intercom tags include `enterprise-fyi` or `enterprise-duplicate` → `false`

Source priority: **manual override → tag → default `true`**. Same chain shape as `effectiveEngagement`.

### Schema

Migration on `intercom_tickets_v3`:
- `rsa_override boolean null` — null = derive from tags

No backfill needed; derivation is live.

### Shared helper

New `src/pages/inbox-v3/rsa.ts`:
```ts
export type Rsa = "required" | "not_required";
export type RsaSource = "manual" | "tag" | "default";
export const RSA_FALSE_TAGS = new Set(["enterprise-fyi", "enterprise-duplicate"]);
export function effectiveRsa(r: { tags: string[] | null; rsa_override: boolean | null }):
  { value: Rsa; source: RsaSource };
```

### Inbox v3

- Add `rsa_override` to the row type + select.
- New compact RSA badge in the ticket row (Required / Not required, with source tooltip — "Manual", "Tag: enterprise-fyi", "Default").
- Click badge → 3-way cycle: derived → force Required → force Not required → derived (writes `rsa_override` to `intercom_tickets_v3`).
- Header filter: `All / Required only / Not required only` (default All).

### Analytics v3

- Pull `tags` + `rsa_override` in the existing select.
- Compute `rsa` per row using the helper.
- New toggle next to the date range: **"Exclude RSA = false"** (default OFF — numbers unchanged until flipped).
- When ON, every existing memo (KPIs, time series, Resolved-by-engineer, etc.) filters rows where `effectiveRsa(...).value === "not_required"` before counting. Single `filteredRows` derivation upstream so all visualizations stay consistent.
- Small caption under the toggle: `N tickets hidden`.

### Out of scope

- No change to Inbox v2 / Analytics v2 (those keep using the engagement chain).
- No edge-function changes — sync already writes `tags`; `rsa_override` is purely client-set.
- No changes to `.lovable/project-knowledge.md` or Flow yet (logic-level update will follow once implemented, per standing rule).

### Files touched

- `supabase/migrations/<new>.sql` — add `rsa_override` column
- `src/pages/inbox-v3/rsa.ts` — new helper
- `src/pages/InboxV3.tsx` — badge, cycle handler, header filter
- `src/pages/AnalyticsV3.tsx` — select fields, `filteredRows`, toggle UI
