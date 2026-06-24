## Goal

Surface the **customer-submitted CSAT rating** (Intercom's native `conversation_rating`) on Inbox v2. Ignore the AI "CX Score" attribute.

126 / 301 current Inbox v2 tickets already carry this in `raw_payload.conversation_rating` — we just need to extract, store, and display it.

## 1. Schema — `inbox_v2_tickets`

Add three columns (mirror the pattern on `manual_conversations` / `gmail_conversations`):

- `csat_rating smallint` (1–5, nullable, validated 1–5 by reusing `validate_csat_rating` trigger)
- `csat_remark text` (nullable)
- `csat_rated_at timestamptz` (nullable)

Attach the existing `validate_csat_rating` trigger to the new table.

## 2. `sync-inbox-v2` edge function

In the upsert builder, extract from `icData.conversation_rating`:

```ts
const cr = icData?.conversation_rating;
csat_rating: typeof cr?.rating === "number" ? cr.rating : null,
csat_remark: typeof cr?.remark === "string" ? cr.remark : null,
csat_rated_at: cr?.created_at ? new Date(cr.created_at * 1000).toISOString() : null,
```

Overwrite on every sync (drift is the signal, consistent with the rest of this table).

## 3. `src/pages/InboxV2.tsx` UI

- **New "CSAT" column** (between Engagement and Owner):
  - Renders the rating as an emoji + number: 😠1 / 🙁2 / 😐3 / 😀4 / 🤩5 (matches Slack-side CSAT prompt)
  - Tooltip shows the remark + rated-at timestamp
  - Blank cell when null
- **Filter dropdown** "CSAT": All / 5 / 4 / 3 / 2 / 1 / Rated / Unrated
- **Sortable** by CSAT (numeric, nulls last)
- **CSV export** — add `csat_rating`, `csat_remark`, `csat_rated_at` columns

## 4. Backfill

After deploy, run `sync-inbox-v2` once with `{ full: true }` so the 126 existing rated rows get populated immediately without waiting for Intercom updates.

## 5. Docs (standing rule)

- Update `.lovable/project-knowledge.md` — Inbox v2 now mirrors customer CSAT
- Update `mem://features/csat.md` — add Inbox v2 as a third storage location alongside `manual_conversations` / `gmail_conversations`
- Update Flow page note for Inbox v2
- Insert a `changelog_entries` row: "Customer CSAT on Inbox v2"

## Out of scope (ask if you want any)

- Aggregating Inbox v2 CSAT into the `/stats` "Customer satisfaction" card
- Per-owner CSAT leaderboard on Inbox v2
- A separate cron to backfill late-arriving ratings on Inbox v2 (the regular `sync-inbox-v2` already re-pulls recently-updated conversations, so late ratings will land naturally — but if a rating arrives on a long-quiet ticket, only a `full: true` run will catch it)
