## Goal

Flag Inbox V2 tickets as "No engagement" when they carry the `enterprise-fyi` or `enterprise-duplicate` tag, surface that in the UI, and include it in the CSV export.

## Definition

A ticket is **No engagement** if its `tags` array contains `enterprise-fyi` OR `enterprise-duplicate` (case-insensitive match, trimmed). Otherwise it's **Engaged**.

Purely client-side derivation — no schema change, no sync change. Tags are already mirrored from Intercom into `inbox_v2_tickets.tags` by `sync-inbox-v2`.

## Changes (all in `src/pages/InboxV2.tsx`)

1. **Helper**
   ```ts
   const NO_ENGAGEMENT_TAGS = new Set(["enterprise-fyi", "enterprise-duplicate"]);
   const isNoEngagement = (tags: string[] | null) =>
     (tags ?? []).some(t => NO_ENGAGEMENT_TAGS.has(t.trim().toLowerCase()));
   ```

2. **Table column** — new "Engagement" column showing a small badge: `No engagement` (muted) or `Engaged` (default). Placed after Status. Included in the existing "Reset columns" visibility set.

3. **Filter** — new "Engagement" dropdown in the filter row with options: All / Engaged / No engagement. Applied client-side after the table fetch (same layer as the Tags filter).

4. **CSV export** — add `Engagement` column to `CSV_COLS` in `ExportPopover`. Value: `"No engagement"` or `"Engaged"`. Derivation runs client-side post-fetch, so it Just Works regardless of date range.

## Out of scope

- No change to `sync-inbox-v2` or `inbox_v2_tickets` schema.
- No change to the live Inbox / `manual_conversations` — sandbox only.
- Tag list is hard-coded for now; if you later want it editable, we can move it to `settings`.

## Project knowledge

Update `.lovable/memory/features/inbox-v2-sandbox.md` with the engagement rule (which tags, where it shows) and bump `.lovable/project-knowledge.md`. Flow page unaffected (no logic flow change).