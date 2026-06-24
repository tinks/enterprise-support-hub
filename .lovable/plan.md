## Goal

Make Engagement in Inbox V2 editable and persistent, and add an on-demand "AI guess" that reviews ticket comments to classify engagement. Sandbox-only — nothing writes back to Intercom.

## Effective-engagement rule (priority order)

1. **Manual override** (if set) — wins over everything.
2. **AI guess** (if set, and no manual override).
3. **Tag-derived** (`enterprise-fyi` / `enterprise-duplicate`) — current behavior.
4. Else `Engaged`.

Values everywhere: `"engaged" | "none"`.

## Schema

Add to `inbox_v2_tickets`:

- `engagement_override text` — `'engaged' | 'none' | null`. Never touched by `sync-inbox-v2`.
- `engagement_ai_guess text` — `'engaged' | 'none' | null`. Written only by the classifier function.
- `engagement_ai_reason text` — short one-liner from the model, shown on hover.
- `engagement_ai_at timestamptz` — when the guess was produced.
- `engagement_override_at timestamptz`, `engagement_override_by text` — for audit / display.

RLS (Row-Level Security): extend existing authenticated-read policy on `inbox_v2_tickets` and add an authenticated `UPDATE` policy so signed-in users can save the override. Service role still owns sync writes.

## UI (`src/pages/InboxV2.tsx`)

1. **Engagement cell** becomes a small dropdown: `Auto (tag/AI)` / `Engaged` / `No engagement`. Picking Auto clears the override. Badge color reflects effective value; a tiny indicator distinguishes source (`tag` / `ai` / `manual`). Tooltip shows AI reason when source is `ai`.
2. **Engagement filter** filters on effective value (unchanged options).
3. **New row action** "AI: guess engagement" in the row menu — runs the classifier for that single ticket, then refreshes.
4. **Bulk button** in the toolbar: "AI-classify visible" — runs the classifier for every currently-filtered row that has no manual override and no AI guess yet (with a confirm + progress toast). Capped at e.g. 50 per click.
5. **CSV export** columns: `Engagement` (effective), `Engagement source` (`tag` / `ai` / `manual` / `default`), `Engagement override`, `Engagement AI guess`, `Engagement AI reason`.

## AI classifier (new edge function `classify-inbox-v2-engagement`)

- Input: `{ ticketIds: string[] }` (1..50).
- For each ticket: fetch the Intercom conversation (`GET /conversations/{id}?display_as=plaintext`) using `INTERCOM_API_TOKEN`, extract source + parts (admin + user comments, skip notes), trim to a sane size.
- Call Lovable AI Gateway (`LOVABLE_API_KEY`, model `google/gemini-2.5-flash`) with a tight prompt: classify as `engaged` or `none`, return JSON `{ verdict, reason }`. "No engagement" = support was cc'd / informed but did no triage, investigation, or reply that moved the ticket forward (FYI, duplicate-of-known-issue, pure ack).
- Write `engagement_ai_guess`, `engagement_ai_reason`, `engagement_ai_at` on `inbox_v2_tickets`. Never touches `engagement_override`.
- Returns per-ticket result for the UI toast.

## Out of scope

- No write-back to Intercom.
- This work touches **only Inbox V2** — the live Inbox, `manual_conversations`, `conversation_mappings`, `gmail_conversations`, and everything else are untouched.
- No auto-run cron for the classifier — on-demand only (single row or bulk button).

## Project knowledge

Update `.lovable/memory/features/inbox-v2-sandbox.md` (override + AI guess + precedence rule) and bump `.lovable/project-knowledge.md`. Flow page unaffected (no automated flow change).
