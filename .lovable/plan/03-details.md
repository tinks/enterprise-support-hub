## Per-surface changes

**Analytics v3** — median/P90 resolution KPI reads `resolution_active_s`. Card label becomes "Resolution (active)", with the raw median shown as a small secondary line beneath and a tooltip stating the definition. Resolution distribution chart plots active only.

**Trend report** — month-over-month resolution series switches to active. This is the surface where mixing is most dangerous: a chart with an August raw point and a September active point is a fabricated trend. Raw is available only as a per-month tooltip value, never as a second series.

**Monthly lookback** — the manual "Load active clock" button goes away; active is what loads. Raw stays in the per-ticket drill-down table as an "Elapsed" column. The Slack summary and narrative export carry active only, with the word "active" in the label so a pasted number is self-describing.

**Insights** — resolution figures in generated commentary read active.

**Exports** — every CSV that currently emits a resolution column emits both, named `resolution_active_s` and `elapsed_raw_s`. No column named plain `resolution_time`.

## Handling the rows the clock can't score

Three cases exist in the data today and each needs a defined display, not a silent zero:

- **2 rows NULL** (no usable timeline in `raw_payload`). Excluded from medians; counted and shown as "2 not computable" beside the KPI rather than dropped invisibly.
- **19 rows active = 0.** Verified on one (`215474764691477`): anchor-inbox assignment and our public reply land on the same second, the customer never replies before close. Real under stop-the-clock, but a 0 pulls the median down. These are included in the median (they are genuine zero-active-time tickets) and surfaced as a "0h active" count on Resolution anatomy so the shape stays visible. Whether all 19 share that structure is UNVERIFIED — the cutover includes checking the remaining 18 and reporting the breakdown before the surfaces ship.
- **Non-finalized tickets** have no active clock at all; they are already excluded from resolution metrics and stay excluded.

## Technical notes

- Surfaces read the persisted columns directly — no client-side recomputation, no per-ticket payload fetch. This is what Option A bought.
- A shared display helper (`src/lib/resolutionDisplay.ts`) owns the labels, the null/zero handling, and the formatting, so the four surfaces cannot drift into different wording.
- Version guard: rows are stamped `active_clock_engine_version = 1`. If a surface encounters a finalized row with a null version, it falls into the "not computable" bucket rather than assuming zero.
- Doc pass (project knowledge via `sync-knowledge-pending`, a `changelog_entries` row, FlowDiagram node) runs once the surfaces land, covering both the writer/backfill work already applied and this cutover as one coherent change.

## Verification before it's called done

1. Per surface, the reported median matches a direct SQL median over the same filtered population — not "looks about right".
2. Trend report shows no month whose series mixes raw and active.
3. The 2 NULL rows appear in the "not computable" count and are absent from every median.
4. The 18 unchecked zero-active rows are individually classified, with any that are not the "instant reply, no customer response" shape reported rather than absorbed.
