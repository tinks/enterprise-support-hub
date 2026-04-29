## Goal

Replace the unified (single-column) diff in `/knowledge` review mode with a **side-by-side** diff viewer so it's obvious what the pending knowledge migration will change before approval. Approve / Reject buttons stay as-is.

## What it looks like

```text
┌─────────────────────────── Toolbar (existing) ──────────────────────────┐
│ project-knowledge.md   [Unified | Side-by-side]      Reject  Approve     │
└─────────────────────────────────────────────────────────────────────────┘
┌──────── Current (live)  ────────┬────────  Pending  ─────────────────────┐
│ 12   ## 2. Architecture          │ 12   ## 2. Architecture                │
│ 13                               │ 13                                     │
│ 14   ### Edge Functions          │ 14   ### Edge Functions                │
│ 15   | slack-events |  …         │ 15   | slack-events |  …               │
│ 16   | check-bot-identity | …    │ 16   | check-bot-identity | …          │
│      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │ 17 + | backfill-intercom-replies | …   │
│      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │ 18 + | promote-pending-…         | …   │
│ 17 - | old-row | retired         │      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│ 18   | list-slack-users | …      │ 19   | list-slack-users | …            │
└──────────────────────────────────┴────────────────────────────────────────┘
```

- Left column = current `content` (live doc).
- Right column = `pending_content`.
- Equal lines aligned on the same row.
- Removed lines: red background on the left, blank gutter on the right.
- Added lines: green background on the right, blank gutter on the left.
- Per-side line numbers in a non-selectable gutter.
- Both columns scroll together (synchronized horizontal + vertical scroll on a shared wrapper).
- A toggle in the toolbar lets you flip between **Unified** (today's view) and **Side-by-side** (new default in review mode). Choice persisted to `localStorage` (`knowledge_diff_view`).
- A small summary chip — "+N additions, −M deletions" — sits next to the toggle.
- An "Only changes" filter (default ON) collapses unchanged regions into a clickable "… 24 unchanged lines …" expander, so you don't scroll past hundreds of identical lines. Toggleable to "Show all".
- Existing pending banner, Approve, and Reject buttons are unchanged.

## Approach

All work happens in `src/pages/ProjectKnowledge.tsx`. Pure UI; no schema or edge-function changes.

1. **Reuse `computeDiff`.** It already returns `Array<{ type: "same" | "added" | "removed"; text }>`. Extend it to also return per-side line numbers.
2. **Build aligned rows** for side-by-side rendering by walking the diff sequence:
   - `same` → emit one row with both sides populated.
   - Pair consecutive `removed` + `added` runs into the same rows where possible (so a modified line shows old vs new on the same row); leftover removed/added become rows with one side blank.
3. **Add view-mode state** `diffView: "unified" | "split"` (default `"split"`, persisted to `localStorage`).
4. **Add "only changes" state** `onlyChanges: boolean` (default `true`, persisted). When true, collapse runs of `same` rows longer than a small context window (3 lines on either side of a change) into a single expandable row.
5. **Render** the split view as a CSS grid (`grid-cols-2`) inside a single scroll container so both columns scroll together. Each cell uses the same `font-mono text-xs leading-relaxed` styling as today, with `bg-green-500/10` for additions and `bg-red-500/10` for removals. Empty (filler) cells get a subtle striped background so it's clear no line exists there.
6. **Toolbar additions**: a small segmented control (Unified / Side-by-side), an "Only changes" switch, and the "+N / −M" summary chip. All only render when `mode === "review"` and `pendingContent` exists.
7. **Keep the unified view intact** as a fallback / power-user option.

## Out of scope

- No word-level intra-line highlighting (line-level only, like today).
- No collaborative review state, comments, or partial approval.
- No changes to Approve / Reject behavior, the migration flow, or the underlying `knowledge_documents` schema.
- No changes to Edit / Preview modes.

## Acceptance

- Opening `/knowledge` while a pending update exists shows a side-by-side diff with the current live doc on the left and the pending content on the right, line numbers in the gutter, and red/green highlighting on changed lines.
- Toggling to Unified shows the existing single-column diff.
- "Only changes" collapses unchanged regions; expanding a collapsed region reveals the hidden lines inline.
- The "+N / −M" chip matches the count of green / red lines visible in either view.
- Approve and Reject still call the same Supabase update as before.
