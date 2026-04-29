## Goal

The live knowledge document in the database is only ~10KB / 117 lines and reads like a high-level summary. The static project file at `.lovable/project-knowledge.md` is the up-to-date, comprehensive ~39KB / 565-line version (lifecycle, dedup mechanisms, internal notes, pending intercom links, owners, navigation, analytics drilldown, etc.). The previous "append-only" pending migration was the wrong approach — it left a thin document plus a few extra bullets.

Merge them by staging the **full static file as a structured replacement** for `pending_content`, then let you approve it via the existing diff viewer on `/knowledge`.

## What goes into the merged document

Use `.lovable/project-knowledge.md` (565 lines) as the canonical base, and fold in anything from the live DB version (117 lines) that isn't already covered. After comparing them, the live version's unique-but-still-valid bits are:

- The KPI/per-source breakdown wording in the **Stats page** description (Slack/Gmail/Manual/Intercom sections, source color palette `#9B87F5` / amber `#F59E0B`).
- The **Source taxonomy** subsection enumerating `manual` / `intercom` / `slack` values and the legacy backfill note.
- Slightly more detailed wording for the **Conversation detail page** (raw IDs collapsible, status dropdown enumerating all states, Intercom linking for Gmail).
- Mention of `import-slack-thread`, `bulk-import-intercom`, `create-intercom-from-import`, `search-intercom-by-email`, `delete-conversation-mapping`, `parse-thread` — most already exist in the static file; only verify nothing is dropped.

Everything else in the live DB doc is already a subset of the static file.

## Execution

1. Read `.lovable/project-knowledge.md` in full as the base.
2. Insert the three additions above into the appropriate sections:
   - Expand §2 "UI Pages" Stats row with the per-source KPI summary + color palette bullet.
   - Add a new "Source taxonomy (`manual_conversations.source`)" subsection under §2 (mirrors the live doc's wording).
   - Expand the Conversation detail description in §2 with the raw-IDs collapsible and Intercom linking bullets.
3. Bump the "Last updated" header to today's date.
4. Write a single migration `supabase/migrations/<ts>_merge_full_knowledge.sql` that does:
   ```sql
   UPDATE knowledge_documents
   SET pending_content = $$<full merged markdown>$$,
       pending_summary = 'Merge full project knowledge: replace summary-only live doc with the comprehensive 565-line version, plus add source taxonomy, per-source stats palette, and conversation-detail raw-IDs section.',
       pending_at = now()
   WHERE id = 'project-knowledge';
   ```
   Use dollar-quoting (`$KNOWLEDGE$ ... $KNOWLEDGE$`) to safely embed all the markdown including single quotes.
5. Delete the now-superseded staging migration `supabase/migrations/20260429143135_stage_pending_knowledge.sql` so the two pending writes don't fight.
6. Sync `.lovable/project-knowledge.md` to match the merged content (header date + the three insertions).

## After approval

Once you click **Approve** on `/knowledge`, the side-by-side diff viewer (built last turn) will show the full additions vs. the current short doc. Approving moves `pending_content` → `content`. The result: the live knowledge doc becomes the full ~40KB authoritative version.

## Files touched

- create `supabase/migrations/<ts>_merge_full_knowledge.sql`
- delete `supabase/migrations/20260429143135_stage_pending_knowledge.sql`
- edit `.lovable/project-knowledge.md` (date + 3 small insertions)
- edit `.lovable/plan.md`

No code, RLS, or schema changes — purely a content merge staged for your approval.
