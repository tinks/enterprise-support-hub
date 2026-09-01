# Roadmap

## Next session (deferred 2026-09-01 by Matt)
- [ ] Display pass for the persisted resolution clocks — REMIND MATT AT START OF NEXT SESSION
  - Now a FOUR-way split (engine v3): active / customer wait / engineering wait / closed
  - Analytics v3: add the four-way sub-line under resolution
  - Trend report: four-way split in the resolution tooltip
  - Resolution anatomy: switch from client-side derivation to the persisted columns
    (`resolution_active_s`, `resolution_customer_wait_s`, `resolution_eng_wait_s`,
     `resolution_closed_s`, `resolution_window_s`)
  - Escalations board: surface `eng_wait_start_at` / `eng_wait_end_at` per linked ticket
  - Doc pass after: project-knowledge via sync-knowledge-pending, changelog row, FlowDiagram node

## Watch (engine v3)
- [ ] `eng_wait_source` fallbacks `dev_escalation_row` and `linear_created` are UNVERIFIED —
      all 30 live rows resolved via `attribute_event`.

## Open by choice
- [ ] Security batches 4 and 5 (deliberately unstarted)
