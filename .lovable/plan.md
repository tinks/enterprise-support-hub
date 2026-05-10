## Improve PDF row spacing and readability

The PDF is a rasterized snapshot of the on-screen report (html2canvas → jsPDF). Tight row spacing and `line-clamp-2` cause descenders to be clipped (Top topics descriptions appear half-cut) and rows to crowd one another (Top accounts, By product area, Owner load).

### Changes — `src/pages/insights/ReportTab.tsx` only

1. **Top topics** (lines 310–329)
   - Container `space-y-3` → `space-y-5`.
   - Each item: add `py-1` to the wrapper, give the title row `mb-1`.
   - Description: drop `line-clamp-2`, use `leading-relaxed` so descenders are not clipped.
   - Product-area badge row: `mt-1` → `mt-2`.

2. **Top accounts mini table** (lines 457–478)
   - `space-y-1` → `space-y-2`.
   - Button `py-1` → `py-1.5`, add `leading-snug`.

3. **By product area** (lines 353–362)
   - `space-y-1.5` → `space-y-2.5`.
   - Bar height `h-4` → `h-5`.
   - Label cell add `leading-snug`.

4. **Owner load table** (lines 374–402)
   - All `py-1.5` cells → `py-2.5` and add `align-middle`.

5. **Highlights** (lines 416–419)
   - `space-y-1.5` → `space-y-2.5`, add `leading-relaxed`.

6. **Export wrapper** (line 199)
   - `space-y-6` → `space-y-8` for clearer section separation in the PDF.

No data, query, or business-logic changes; spacing-only edits to make the rasterized PDF readable.