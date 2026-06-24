## Add changelog entry for Inbox v2 engagement

Insert one new row into `changelog_entries` covering the engagement persistence + AI classifier work shipped today on Inbox v2.

### Entry

- **Title:** Engagement tracking on Inbox v2
- **Body (user-facing):**
  - Every Inbox v2 ticket now has an Engagement value (Engaged / No engagement) derived from tags by default (`enterprise-fyi` and `enterprise-duplicate` → No engagement).
  - You can override the value inline from the Engagement column; overrides are saved per ticket and survive sync.
  - A source chip shows where each value came from: manual, AI, tag, or default — hover it to see the AI's reasoning when applicable.
  - New on-demand AI classifier reads the Intercom conversation and best-guesses engagement: click the sparkles on a single row, or "AI-classify visible" to process up to 50 filtered rows at once.
  - Engagement filter and CSV export updated to use the effective value.
- **Category:** matches the existing Inbox v2 entries (will mirror whatever `category`/tags those rows use).
- **created_at:** now.

### Out of scope

- No UI changes to the Changelog page itself.
- No new fields on `changelog_entries`.
- No additional logic changes to Inbox v2 — this is purely the release note for work already shipped.

### Technical

- One `INSERT` into `public.changelog_entries` via a migration, matching the column shape of the most recent Inbox v2 entries (inspect `On-demand backfill on Inbox v2` row first to copy `category` / any tag columns verbatim).
