## Goal

Auto-classify the 55 unclassified April 2026 tickets into one of: **Issue, Configuration, Bug, FR, Question** — and ship a reusable button on the Conversations view to do the same for any future unclassified batch.

## Approach

**One edge function** (`auto-classify-conversations`) does the work. It:

1. Accepts `{ from, to, ids?, dryRun? }`.
2. Loads unclassified rows from `conversation_mappings`, `gmail_conversations`, and `manual_conversations` in that date range (matching the same "Unclassified" definition the Insights tab uses: no `classification` and not flagged as `is_bug` / `is_feature_request`).
3. For each ticket, builds a compact prompt from subject + first user message (and a couple of replies for manual / Slack so context is enough).
4. Calls Lovable AI (`google/gemini-3-flash-preview`) via the AI SDK with `Output.object` returning `{ classification: enum, confidence: number, reason: string }`.
5. Updates the row's `classification` (skips writes if `dryRun=true` or confidence < 0.4 — those are returned as "needs review").
6. Returns a per-source breakdown + counts + per-ticket results.

**Run-now step**: After deployment, I invoke the function with April's date range so the 55 rows get classified immediately. Results are surfaced to you in chat.

**Reusable UI button**: On the Conversations page, when the user is in the classification drilldown (`classification=unassigned` + `from`/`to` + `showAll=1`), show an **"Auto-classify with AI"** button in the header. It:

- Confirms ("This will classify N rows using AI"), then calls the edge function.
- Shows a toast with results (`X classified, Y needs review, Z failed`).
- Refreshes the table.

## Definitions

- **Issue** — user is hitting unexpected/incorrect behavior in the product (not necessarily reproducible bug). SSO/permissions/account problem the user needs help configuring.
- **Configuration** — setup/admin
- **Bug** — clear reproducible defect in the product.
- **FR** — feature request / enhancement ask.
- **Question** — how-to / clarification / general inquiry, no broken behavior.

These definitions go into the system prompt so AI classifies consistently with how humans do.

## Files

- `supabase/functions/auto-classify-conversations/index.ts` (new)
- `src/pages/Conversations.tsx` — add "Auto-classify with AI" button visible in classification drilldown mode
- `.lovable/project-knowledge.md` + Flow page node — document the new function

## Safety

- `dryRun=true` mode supported (button offers a "Preview" option in a confirm dialog optional — keep simple for now: direct run).
- Low-confidence (<0.4) rows are not written; they're returned for manual review.
- Each write is per-row so a single failure doesn't roll back the batch.
- Function is `verify_jwt = true` (default) so only authenticated app users can trigger it.

## Result

You get the 55 April tickets classified now, plus a button to repeat this for any month going forward.