
# SLA breach overrides — write/read map + minimal surfacing fix

## 1. Where overrides are CREATED (write)

- **`src/pages/SlaWorkbench.tsx` — `ExcuseDialog`** (lines **1767–1834**).
  - Reason `<Select>` with 4 options — Holiday / Customer-side hold / Data artifact / Other (lines **1810–1821**).
  - Free-text `<Textarea>` for `note` (lines **1822–1825**).
  - Upsert into `sla_breach_overrides` on `(intercom_conversation_id, metric)` — lines **1789–1794**.
- Trigger buttons live in `ComplianceSection`'s FR + Resolution breach tables via `<ExcuseCell onExcuse={…}>` (lines **1605–1616** and **1682–1693**), which open the dialog by setting `excuseTarget` (state at **1229**).
- This is the **only** create site in the frontend. (Delete/remove path: `.from("sla_breach_overrides").delete()` at lines **1612** and **1689**.)

## 2. Where overrides are READ + RENDERED

Shared hook: **`src/hooks/useSlaBatch.ts`** loads the full table into a `Map` (lines **221–240**) and exposes `isExcused` (247) + `getOverride` (243). Full row is available to consumers, including `reason` and `note`.

Render sites:

| # | File : lines | Uses `reason`? | Uses `note`? | What it shows |
|---|---|---|---|---|
| A | `src/pages/SlaDashboard.tsx` : **291–292, 317–318** (leadership scorecard, per-customer rows) | No | No | Just a count: `· {N} excused` next to breach counts. |
| B | `src/pages/SlaWorkbench.tsx` `ComplianceSection` FR-breach table row : **1578–1618** | No (row-level) | No | Row visually marked with `opacity-60 line-through` (line **1582**). |
| C | `src/pages/SlaWorkbench.tsx` `ComplianceSection` Resolution-breach table row : **1652–1694** | No (row-level) | No | Same strikethrough treatment (line **1656**). |
| D | `src/pages/SlaWorkbench.tsx` `ExcuseCell` : **1723–1765** (rendered inside each excused row in B/C above) | Yes — inline text `Excused · {reason}` (lines **1736–1741**) | **Only as a native browser `title=` tooltip** on the same span (line **1738**) | Reason is visible; note is effectively hidden — hover-only, no visual affordance, doesn't work on touch, easy to miss. |

No other components query `sla_breach_overrides` or consume `getOverride`/`isExcused`.

## 3. Gap confirmation

The `note` a user types in the ExcuseDialog is **never rendered as visible text anywhere** in the app after save. Its single surfacing is the `title={override.note ?? ""}` attribute on the "Excused · {reason}" span in `ExcuseCell` (SlaWorkbench.tsx line **1738**) — a browser tooltip on hover. `reason` is at least shown inline on that same span; on the Dashboard, neither reason nor note appears at all (only an "excused" count). So yes, the gap is real: humans have no visible way to review the note they wrote.

## 4. Minimal surfacing fix (proposal)

Scope: **`src/pages/SlaWorkbench.tsx` only** — extend the existing "Excused · {reason}" indicator inside `ExcuseCell` (lines **1733–1751**) so the note is visible, not hover-gated. No new components, no schema/hook/query changes, no Dashboard changes (Dashboard is intentionally aggregate-only; the practitioner surface is Workbench, which is already where the "Excuse" action lives per project docs).

Two options, both small; recommend **Option A** for lowest change:

- **Option A — inline note under the reason chip (recommended).** In `ExcuseCell`, keep the current inline `Excused · {reason}` chip and, when `override.note` is non-empty, render a second line beneath it: `<div className="text-[11px] text-muted-foreground italic max-w-[280px] truncate" title={override.note}>"{override.note}"</div>`. Keeps `title` as the full-text fallback for long notes; matches the existing muted-foreground / xs-text idiom used throughout `ComplianceSection`. Both FR and Resolution breach tables inherit it automatically since both use `ExcuseCell`. The `Action` column already renders arbitrary content, so no table layout changes required beyond the cell being taller when a note exists.

- **Option B — small expand toggle on the chip.** Turn "Excused · {reason}" into a `<button>` with a `▸/▾` glyph that toggles a note block below. More clicks, more state, no real benefit given notes are short.

Not proposed: Dashboard surfacing, a separate audit page, or hover-cards — all would be over-engineering for the stated problem ("user entered notes and has no way to view them"). If leadership later needs to see excuse rationale on `/sla`, that is a follow-up.

### Files that would change (fix pass, for reference only — do not implement yet)
- `src/pages/SlaWorkbench.tsx` — `ExcuseCell` body only (~4 lines added).

### Docs-of-record follow-up
After the fix, one-line update to `.lovable/project-knowledge.md` + `src/pages/FlowDiagram.tsx` where the SLA Workbench compliance section is described, noting that excused breaches now show reason **and note** inline in the breach tables.
