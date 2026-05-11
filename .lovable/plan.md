## Goal

Fix the mobile rendering of the home page (`/` → `src/pages/Stats.tsx`). The screenshot shows three issues at ~400px width:

1. **Hero banner** — the title "Lovable Enterprise Support Hub" wraps oddly and is overlapped by the Slack App / Intercom buttons because the banner forces a single row.
2. **Filters row** — Environment / Source / Timeframe / Channels each use a fixed 180px Select with the label inline, which overflows the viewport and looks misaligned on mobile.
3. **General padding / typography** — `p-6` plus `text-2xl` is too large for narrow screens; the logo + text get cramped.

The Insights/Report tab and other tabs also share `AppLayout` and similar filter patterns, but the user's screenshot is the Stats page so this plan focuses there.

## Changes (all in `src/pages/Stats.tsx`)

### 1. Hero banner (lines 1029–1047)
- Change wrapper from `flex items-center justify-between … p-6` to stack on mobile: `flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6`.
- Inner title block: keep logo + text in a row, but allow the text block to use `min-w-0` and the heading to use `text-xl sm:text-2xl` with `break-words` so it no longer collides with the buttons.
- Action buttons (`Slack App`, `Intercom`): wrap in a container that uses `flex flex-wrap gap-2` and stays left-aligned on mobile.

### 2. Filters row (lines 1050–1203)
- Change outer container from `flex flex-wrap items-center gap-4` to `flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4`.
- For each filter (Environment, Source, Timeframe, Channels):
  - Change inner wrapper from `flex items-center gap-2` to `flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto`.
  - Change the Select trigger / channels Popover button width from `w-[180px]` to `w-full sm:w-[180px]`.
- Custom-range button and Export PDF button: add `w-full sm:w-auto` so they don't sit awkwardly on a half-line.

### 3. Page padding (line 1027)
- Change `mx-auto max-w-5xl space-y-6 p-6` to `mx-auto max-w-5xl space-y-6 p-4 sm:p-6`.

### 4. Quick sweep of downstream sections
- No structural changes to the chart cards in this pass; recharts containers are already responsive. We will only add `overflow-x-auto` on any wrapper that currently sets a fixed min-width if found while editing (verify with a quick read of lines 1210–1700 during implementation; do not change layouts beyond preventing horizontal overflow).

## Out of scope

- AppLayout sidebar (already collapses to 56px and works on mobile).
- Insights/Report tab redesign, PDF export styling, and any logic changes.
- Tablet-specific tuning beyond the existing `sm:` breakpoint.

## Verification

- Open preview at the current mobile viewport (402×716) and confirm hero text is no longer overlapped, all four filter rows fit within the viewport, and the Export PDF button is reachable without horizontal scroll.
- Re-check at `sm` (≥640px) to confirm the desktop layout is unchanged.
