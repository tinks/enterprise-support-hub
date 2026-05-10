## Goal

A new repeatable monthly view that buckets all Intercom tickets into topics + product areas using AI. Built into the app so you can re-run it on the 1st of every month without copy-pasting.

## Where it lives

New left-nav item **Insights** → page at `/insights`. Top of page: a month picker (defaults to last completed month). Below: the bucketed analysis for that month.

If results already exist for that month, show them instantly. A "Regenerate" button re-runs the AI.

## Data model (new table)

```sql
monthly_insights
  id uuid pk
  month text          -- 'YYYY-MM', unique
  source text         -- 'intercom' for now (extensible later to slack/gmail)
  generated_at timestamptz
  ticket_count int
  buckets jsonb       -- [{name, description, ticket_count, product_areas: {area: count}, example_subjects: [...], ticket_ids: [uuid,...]}]
  product_area_summary jsonb  -- {"SSO": 12, "Cloud/AI": 9, ...}
  overall_summary text        -- 2-3 paragraph executive summary
```

RLS: authenticated read/insert/update.

## Edge function: `analyze-intercom-month`

Input: `{ month: 'YYYY-04' }`

Steps:
1. Pull all `manual_conversations` where `source='intercom'`, `is_test=false`, `status != 'cancelled'`, created_at in month → ~153 rows for April.
2. For each ticket, pull the first 1–2 `manual_messages` (user role, not internal note) so the AI sees the real question, not just the subject.
3. Build a compact JSON list `[{id, subject, first_message (truncated to 800 chars), current_product_area, current_classification}, ...]`.
4. Call Lovable AI (`google/gemini-3-flash-preview`) with structured output (Zod schema) in **two passes**:
   - **Pass A — Discover buckets**: send all tickets, ask the model to propose 6–10 topic buckets that cover the full set with short names + 1-line descriptions. No assignment yet.
   - **Pass B — Assign tickets**: send the bucket list + tickets in chunks of ~50, ask the model to return `[{ticket_id, bucket_name, product_area}]`. Product area constrained to the existing list from `settings.product_areas` plus "Other".
5. Aggregate counts, pick 3 example subjects per bucket, write a short overall summary (third AI call).
6. Upsert into `monthly_insights` keyed by `(month, source)`.

This is the "two-pass" pattern because asking one call to both discover taxonomy and assign is unreliable on 150+ items.

## UI: Insights page

```
┌──────────────────────────────────────────┐
│ Insights                                 │
│ [Month: April 2026 ▼]  [Regenerate]      │
├──────────────────────────────────────────┤
│ 153 Intercom tickets analyzed            │
│ Generated 2 hours ago                    │
│                                          │
│ Executive summary                        │
│ <2-3 paragraph AI overview>              │
├──────────────────────────────────────────┤
│ Topic buckets                            │
│ ┌────────────────────────────────────┐   │
│ │ SSO / SAML setup        38 tickets │   │
│ │ Most cover SCIM provisioning…       │   │
│ │ Top areas: SSO (32), Other (6)     │   │
│ │ ▸ Help - SAML configuration not... │   │
│ │ ▸ SCIM sync failing for…           │   │
│ │ [View all 38 →]                    │   │
│ └────────────────────────────────────┘   │
│ <one card per bucket, sorted by count>   │
├──────────────────────────────────────────┤
│ By product area (bar chart)              │
└──────────────────────────────────────────┘
```

- Bucket card click → modal/drawer with all ticket subjects + links to Conversation Detail.
- Bar chart uses existing `chart` shadcn component with brand colors.

## Repeatability

- Page defaults month picker to previous calendar month.
- Optional follow-up (not in this plan unless you want it now): pg_cron job on the 1st of each month auto-calling `analyze-intercom-month` for the prior month so insights are pre-warmed.

## Files to create / change

- `supabase/migrations/<ts>_monthly_insights.sql` — table + RLS
- `supabase/functions/analyze-intercom-month/index.ts` — the AI clustering function
- `src/pages/Insights.tsx` — new page
- `src/App.tsx` — add `/insights` route
- `src/components/AppLayout.tsx` — add "Insights" nav link
- `.lovable/project-knowledge.md` + memory file describing the new feature

## Out of scope

- Other sources (Slack, Gmail). Intercom only for v1; the table column `source` is there to extend later.
- Auto-cron. Manual run button is enough until you want it pre-warmed.
- Editing buckets manually. v1 is read-only AI output.

## Cost note

Two AI passes per regeneration on ~150 tickets ≈ a few cents in Lovable AI credits. Cached after first run.

## Open question (one)

For the **product area** the AI assigns: should it (a) overwrite the existing `product_area` on the ticket if missing, or (b) stay purely in the insights view and never touch ticket records? I default to **(b)** unless you say otherwise — keeps insights non-destructive.
