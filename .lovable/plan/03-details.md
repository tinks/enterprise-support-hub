## Also worth fixing while I'm in there

**The queue tab silently hides search hits.** Search runs across the whole filtered population, but you only see the rows in the active tab. Landing on "Needs Linear" (the default) and searching for a ticket that *has* a Linear link returns nothing visible. I'll show the per-tab hit counts on the tab labels when a search is active, so a hit in another tab is obvious rather than looking like "not found".

**State filter.** Default is "Active", which hides `customer_notified` and `wont_do`. SCA-3522 is open so this wasn't the cause here, but the same "nothing found" feel applies. Same treatment: when a search is active and hits exist outside the current state filter, say so.

## Technical notes

- `src/pages/Escalations.tsx` only — no schema change, no edge function, no writes to Intercom or Linear.
- Change the `rows` memo's type gate from `tt !== "Bug" && tt !== "Feature Request"` to: accept `Bug | Feature Request | Issue | Incident`, or accept any type when `resolveLinear(...)` yields a non-null `raw`. The existing `transferred_out` / `not_enterprise` exclusions are unchanged.
- `EscalationRow.type` is currently typed `"Bug" | "Feature Request"`; widen it to `string` and let the type filter dropdown build its options from the population instead of a fixed pair.
- The batched notes fetch in `load()` uses the same predicate — factor the predicate into one function so the board and the notes prefetch can't drift.
- Sorting, hub state, notes, Linear sync, and the detail sheet are untouched.
- Per convention, this is a logic change: changelog row, `.lovable/project-knowledge.md` via `sync-knowledge-pending`, and a FlowDiagram detail line on the Dev escalations node.

## Verification

- Search `SCA-3522` → the ticket appears under "Linked escalations".
- Report the before/after board counts (currently 39 rows pass the gate; expect the 29 linked strays plus the unlinked Issue/Incident population to join).
- Confirm no Question/Configuration ticket without a Linear reference enters the board.
