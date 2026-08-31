## Search visibility stays

The per-tab hit counts and the "hits hidden by the state filter" hint added this morning stay as they are — they're what turns a "not found" into "it's in the other tab". No change there.

## Technical notes

- `src/pages/Escalations.tsx` only. No schema change, no edge function, no writes to Intercom or Linear.
- `ESCALATION_TYPES` becomes `["Bug", "Feature Request", "Incident"]` — `Issue` removed. The `qualifies()` helper (shared by the row build and the batched notes prefetch) is otherwise unchanged: type match **or** a resolvable Linear reference.
- Everything else from this morning stands: `EscalationRow.type` stays `string` (types beyond Bug/FR now appear via the link rule), the type filter builds its options from the population, `matchesSearch()` drives the tab hit counts.
- Sorting, hub state, notes, Linear sync and the detail sheet untouched.
- Docs: changelog row correcting today's entry, `.lovable/project-knowledge.md` via `sync-knowledge-pending`, and the FlowDiagram escalations node corrected.

## Verification

- Report the actual board counts after the change and confirm they match 44 / 19 / 25 / 69.
- Confirm "Needs Linear" holds only Bug / Feature Request / Incident rows.
- Confirm searching `SCA-3522` and `CLO-1225` finds them under Linked escalations.
