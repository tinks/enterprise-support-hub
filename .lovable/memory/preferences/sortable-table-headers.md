---
name: Sortable table headers by default
description: Every data table in the Hub should have sortable column headers unless order is semantically fixed
type: preference
---

Default convention: any table rendering rows of data must have sortable headers (click to sort, click again to reverse, indicator arrow).

**Exceptions:** tables whose order is semantically fixed (e.g. a queue deliberately sorted oldest-first as its grading signal) still get sortable headers, but keep their default sort on load.

**How to apply:** implement sorting once in the shared `src/components/issues/IssueTable.tsx` (per-column `sortValue`, `defaultSort`), so every view built on it inherits it. Hand-rolled `<Table>` surfaces get sorting added as they are touched.
