

## Replace CSV export with PDF report

### What it does
Replaces the current "Export CSV" button with an "Export PDF" button that generates a professional PDF report containing all the summary metrics and chart data currently displayed on the Stats page. The PDF will include:

1. **Header** — "Lovable support analytics" with filter context (source, timeframe, environment)
2. **Summary metrics table** — Slack total, email total, resolved, escalated, open, cancelled, success rate, avg/day, median/avg resolution times (both Slack and Gmail)
3. **Chart data as tables** — Since we can't render Recharts into a PDF easily, we export the underlying data:
   - Conversation volume (daily Slack + Gmail counts)
   - Hourly activity distribution
   - Channel breakdown
   - Daily outcomes (resolved/open/escalated/cancelled per day)
   - Resolution time distribution buckets
   - Customer domain breakdown (Gmail)
   - Escalation rate trend
4. **Insights footer** — Peak day, currently active count

### Technical approach

Use a backend function to generate the PDF with a library, keeping it simple and reliable. Actually, since this is a client-side app and the data is already computed in the browser, we'll generate the PDF client-side using `jspdf` + `jspdf-autotable` for clean tables, and `html2canvas` to capture the actual rendered charts as images.

**Better approach**: Use `html2canvas` to screenshot each chart card, then compose them into a PDF with `jspdf`. This gives us the actual visual charts in the PDF, not just data tables.

### Changes

**`package.json`** — Add `jspdf`, `html2canvas` dependencies

**`src/pages/Stats.tsx`**

1. Replace `exportCSV` with `exportPDF` function that:
   - Uses `html2canvas` to capture the entire stats content area (or individual chart cards)
   - Composes captured images into a multi-page PDF using `jspdf`
   - Adds a title header with filter context on page 1
   - Adds summary metrics as a formatted text section
   - Appends each chart screenshot as an image on subsequent pages
   - Triggers download with filename `stats-report-{date}-{source}-{range}.pdf`

2. Add `ref` to the main content container to enable screenshot capture

3. Change button label from "Export CSV" to "Export PDF" and update icon

**`src/pages/FlowDiagram.tsx`** — Update documentation to reflect PDF export instead of CSV

### Files to edit
- `src/pages/Stats.tsx` — replace CSV export with PDF generation
- `src/pages/FlowDiagram.tsx` — document change

