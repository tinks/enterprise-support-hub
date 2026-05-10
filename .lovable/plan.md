# Fix PDF page cuts and "By product area" readability

Two related issues in the monthly report (`src/pages/insights/ReportTab.tsx`).

## 1. PDF cutting rows mid-content

**Root cause.** `exportPdf` rasterizes the whole report into a single giant PNG, then slices it by a fixed page height (`pdfH`). The slicer has no idea where cards or rows start/end, so it cuts straight through "Median handling time", "Preview"/"SCIM" bars, etc.

**Fix (page-aware, section-based render).**
- Stop creating one huge canvas. Instead, iterate the top-level children of `reportRef.current` (header, KPI grid, each `<Card>`, footer).
- Rasterize each section separately with `html2canvas`.
- For each section image, compute its mm height. If it fits in the remaining space on the current PDF page, draw it there. Otherwise:
  - If the section itself is shorter than a full page, start a fresh page and place it at the top.
  - If the section is taller than a full page (e.g. long Owner load table), fall back to the existing slice-by-page-height behavior **for that section only**, so big tables still render but small sections are never cut.
- Track a running `cursorY` per page; add small top/bottom page margins (~6 mm) so nothing kisses the page edge.
- Keep `scale: 2`, white background, `useCORS: true`.

This guarantees Cards (Source mix, Channels, Top topics, Top accounts, By product area, Owner load, Highlights) are never split across pages.

## 2. "By product area" bars hard to read

**Root cause.** Each row is `flex items-center gap-3` with a 20 px (`h-5`) bar and a `text-xs leading-snug truncate` label. Row intrinsic height is driven by the bar; in the rasterized PDF the labels render with their descenders clipped by the next row, producing the "letters cut in half" effect in the screenshot. `truncate` also chops names like "Security/Compliance" → "Security/Complia…".

**Fix (presentation-only, same data).**
- Give each row an explicit height (`h-7`) and keep `items-center`.
- Increase label column width from `w-32` (128 px) to `w-44` (176 px) so common names fit without truncation.
- Remove `truncate` + `leading-snug`; add `leading-tight` and a `title={pa.name}` tooltip as fallback for the rare extra-long name.
- Bump bar height from `h-5` to `h-6` and increase row gap from `space-y-2.5` to `space-y-3` for breathing room.
- Right-align count column stays `w-10 text-right`; use `tabular-nums` so digits line up.

No data, query, or business-logic changes — purely export pipeline + product-area row styling.

## Files touched

- `src/pages/insights/ReportTab.tsx`
  - Rewrite `exportPdf` (≈30 lines) to paginate per section.
  - Update the "By product area" block (lines 352–363).
