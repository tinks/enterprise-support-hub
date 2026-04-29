## Problem

Intercom conversation parts with `part_type === "note"` (internal admin notes inside Intercom) are explicitly skipped by every Intercom ingestion path. As a result, when you import an Intercom ticket, those notes never appear in the Messages section on the conversation detail page.

The user-facing internal notes feature we built (yellow inline cards via `conversation_notes` table + composer) is unrelated and should keep working as-is.

## Approach

Treat Intercom notes as messages, but flagged so the UI can render them with the same yellow "Internal note" styling already used for inline notes — clearly distinct from customer/agent messages, interleaved chronologically.

### 1. Schema change

Add a column to `manual_messages`:
- `is_internal_note boolean NOT NULL DEFAULT false`

(No new table — keeps notes in the same chronological message stream and avoids a second merge pass in the UI. Our own `conversation_notes`-backed composer is untouched.)

### 2. Edge functions — stop skipping notes for Intercom imports

Update the four functions that currently filter `"note"` out of `SKIP_PART_TYPES`, so notes are ingested into `manual_messages` with `is_internal_note: true`, `role: "admin"`, sender = note author:

- `supabase/functions/import-intercom-ticket/index.ts` — remove `"note"` from `SKIP_PART_TYPES`; when `part.part_type === "note"`, set `is_internal_note: true` on the inserted row.
- `supabase/functions/backfill-intercom-replies/index.ts` — same change so historical imports backfill missing notes (existing dedup by epoch will skip already-present comment rows; new note rows will be added).
- `supabase/functions/poll-intercom-inbox/index.ts` — same.
- `supabase/functions/backfill-enterprise-inbox/index.ts` — same.
- `supabase/functions/intercom-webhook/index.ts` — same, so notes added in Intercom after import flow into the thread in real time. Keep the existing `last_intercom_part_id` claim (notes have part IDs too, so dedup still works).
- `supabase/functions/bulk-import-intercom/index.ts` — already has special handling skipping notes; flip it to ingest with the flag set.

Notes with empty/HTML-stripped bodies still skipped (no change).

### 3. UI — render notes inline in the Messages thread

In `src/pages/ConversationDetail.tsx`, the manual/Intercom message renderer already maps `manual_messages` into the chronological items list. Add a branch: if `m.is_internal_note`, render with the existing yellow "Internal note" card style (same visual treatment used by `renderInlineNote`) instead of the user/agent bubble. Sender name shown as the note author.

No changes needed for Slack or Gmail renderers — they don't have Intercom notes in their tables.

### 4. Backfill existing imported tickets

After deploy, run `backfill-intercom-replies?recent=false` (paginated) to pull notes into already-imported tickets. The function's existing missing-by-epoch logic will only insert notes that aren't already there.

### 5. Documentation

- Update `.lovable/memory/features/internal-notes.md` to note that Intercom-origin notes are stored in `manual_messages` with `is_internal_note=true` and rendered using the same yellow card styling, while user-authored notes continue to use `conversation_notes`.
- Update `.lovable/project-knowledge.md` and the Flow page entry for Intercom ingestion to mention notes are now included.

## Out of scope

- Posting notes back to Intercom from our app (read-only ingestion only).
- Slack/Gmail "internal note" concepts (not applicable).
- Migrating existing `conversation_notes` entries — they stay where they are.
