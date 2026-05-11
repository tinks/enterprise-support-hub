## Problem

In the April PDF export, the **Top accounts** card is hard to read: the three columns (Slack / Gmail+Intercom / Manual contacts) come out blurry, with names truncated and rows spaced too far apart.

Two things combine to cause this:

1. The on-screen card is rendered at the report's natural width, which is wide. When `html2canvas` rasterises it and we then scale the resulting image down to fit the A4 content width (~198 mm), every row of small text gets squeezed and softened.
2. The mini-tables use `truncate` on the label, so long account names (e.g. `#paymentology-lovable`, `#team-enterprise-support`, `safetynet-it.com`) get cut with an ellipsis once the column is narrow, which is exactly what happens after the down-scale.

## Fix (PDF export only — no change to the on-screen UI)

Scope the change to `src/pages/insights/ReportTab.tsx`, in the `exportPdf` flow and the Top accounts markup:

1. **Print-mode class on the report root during capture.**
   Before calling `html2canvas`, temporarily add a `data-pdf-export` attribute to `reportRef.current`, and remove it in a `finally` block. This lets us target export-only styles without touching the live UI.

2. **Force a print-friendly layout for Top accounts under that attribute.**
   - Always render the three account tables as a 3-column grid (not responsive), so the card uses its full width even on the export canvas.
   - Drop `truncate` and allow account labels to wrap to a second line, so names like `#team-enterprise-support` and `safetynet-it.com` are never cut.
   - Bump the row text from `text-sm` to a slightly larger size and tighten vertical padding so each row stays compact but legible after scaling.
   - Remove hover/affordance styles that don't matter in print.

3. **Sharper raster.**
   - Render `html2canvas` at `scale: 3` instead of `2` for the Top accounts section specifically (or for all sections — cheap and improves overall sharpness). Keep PNG output.

4. **Keep section-by-section pagination as-is** so the Top accounts card stays a single block and isn't sliced mid-row.

No business logic, data aggregation, or other report sections change. The on-screen Top accounts card continues to look exactly as it does today.

## Verification

- Open Insights → Report, pick April, click Download PDF.
- Confirm the Top accounts card on the resulting PDF:
  - shows all three columns side by side,
  - shows full account names (no `…` truncation),
  - is visibly sharper than before.
- Confirm the on-screen Top accounts card is unchanged.