# Merge SLA breaches and triage violations into one violations table

Decision inputs already settled: overrides get unified into a single table, and the 30-minute triage target is treated as agreed (no "provisional" labelling anywhere).

Current state, verified: the Workbench renders three tables — First-Response breaches and Resolution breaches inside `ComplianceSection` (backed by `sla_breach_overrides`, unique on conversation + metric, 4 rows today), and Triage violations in `TriageViolationsSection` (backed by `triage_overrides`, unique on conversation, 0 rows today). The two override tables use different reason vocabularies and different RLS (breach overrides are admin-write; triage overrides are team-write).

## 1. Mockups

### Option A — one row per ticket

A ticket appears once; each metric gets a cell. Empty cell = met or not evaluable. Clicking a red cell opens the excuse dialog for that metric.

```text
Violations (14 tickets · 19 misses · 6 excused)                    [window: Last month v]

 TICKET                          CUSTOMER   SEV   TRIAGE      FIRST RESP     RESOLUTION   
 ─────────────────────────────────────────────────────────────────────────────────────────
 Deploy stuck on build step      Klarna      1    1h 12m ✗    22m ✗          —            
 #12849                                           vs 30m      vs 15m         met          
                                                  [excuse]    Excused ·                   
                                                              holiday                     
                                                              "EU public hol."            
 ─────────────────────────────────────────────────────────────────────────────────────────
 SSO login loop for 3 users      Atlassian   2    48m ✗       —              9d 4h ✗      
 #12871                                           vs 30m      met            vs 5d        
                                                  Excused ·                  [excuse]     
                                                  off hours                               
                                            ⚑ answered before Sev assigned                
 ─────────────────────────────────────────────────────────────────────────────────────────
 Webhook retries duplicated      Mercado     3    —           —              14d 2h ✗     
 #12902                                           met         met            vs 10d       
                                                                             [excuse]     
 ─────────────────────────────────────────────────────────────────────────────────────────
 Editor freezes on large file    Lotus Bl.   2    2h 07m ✗    1h 41m ✗       6d 1h ✗      
 #12915                                           vs 30m      vs 30m         vs 5d        
                                                  [excuse]    [excuse]       [excuse]     
                                            ⚑ Sev recorded at close                       
```

Reads as "which tickets went wrong, and how badly." The triple-miss row is visible at a glance. Cells are dense; a fully-excused ticket still occupies a row.

### Option B — one row per violation

Each miss is its own row with a Type column. Closest to today's tables.

```text
Violations (19)                                                    [window: Last month v]
 [All] [Triage 7] [First response 5] [Resolution 7]        [ ] Hide excused

 TYPE            TICKET                        CUSTOMER   SEV   MEASURED   TARGET  OVERRIDE
 ─────────────────────────────────────────────────────────────────────────────────────────
 Triage          Deploy stuck on build step    Klarna      1    1h 12m     30m     [excuse]
                 #12849
 First response  Deploy stuck on build step    Klarna      1    22m        15m     Excused ·
                 #12849                                                            holiday
 Triage          SSO login loop for 3 users    Atlassian   2    48m        30m     Excused ·
                 #12871  ⚑ answered before Sev                                     off hours
 Resolution      SSO login loop for 3 users    Atlassian   2    9d 4h      5d      [excuse]
 Resolution      Webhook retries duplicated    Mercado     3    14d 2h     10d     [excuse]
 Triage          Editor freezes on large file  Lotus Bl.   2    2h 07m     30m     [excuse]
 First response  Editor freezes on large file  Lotus Bl.   2    1h 41m     30m     [excuse]
 Resolution      Editor freezes on large file  Lotus Bl.   2    6d 1h      5d      [excuse]
```

Simple, sortable by size of miss, filterable by type, one uniform row shape. Same ticket repeats; the "missed all three" pattern is invisible unless sorted by ticket.

Recommendation: **Option A**. It is the only shape that shows the discipline-vs-speed correlation in one look, and the count of distinct problem tickets is the number that matters in a review.

## 2. Clock handling

Triage is business-hours primary. First response and resolution already carry a per-metric `clock` (business or calendar). Each cell shows its measured value against its own target with a small clock suffix — no attempt to force one clock across the table.

## 3. Unified overrides table

New `public.sla_violation_overrides`, unique on `(intercom_conversation_id, metric)` where metric is `triage | first_response | resolution`. Merged reason vocabulary:

`holiday`, `off_hours`, `customer_hold`, `non_support_thread`, `recorded_at_close`, `answered_before_classified`, `data_artifact`, `genuine_miss`, `other`

The reason dropdown filters the list per metric: triage cells offer the triage-relevant reasons, first-response and resolution cells offer the breach-relevant ones, `other` always available.

Migration steps:
1. Create the table with grants, RLS, and an updated_at trigger.
2. Copy the 4 existing `sla_breach_overrides` rows in with their metric and reason preserved. `triage_overrides` is empty, so nothing to migrate there.
3. Leave both old tables in place, untouched, as a rollback path. Dropping them is a separate later pass once the merged view is trusted.

RLS: SELECT/INSERT/UPDATE for any authenticated user, DELETE for admins only — the team-writable pattern already used by `triage_overrides` and `esh_backlog_items`. This widens write access relative to `sla_breach_overrides` (currently admin-only insert/update); flagging it explicitly rather than deciding it silently — say the word if breach excuses should stay admin-only and the policy will split by metric instead.

## 4. Frontend changes

- `src/hooks/useSlaBatch.ts` — point the overrides loader at the new table, extend `SlaOverrideMetric` with `"triage"`, widen `SlaOverrideReason`.
- `src/pages/SlaWorkbench.tsx` — replace the two breach sub-tables inside `ComplianceSection` and the whole `TriageViolationsSection` with one `ViolationsSection` in Option A shape. Per-severity summary rows, the FR basis toggle, and the by-source breakout stay where they are in `ComplianceSection`; only the breach detail tables move out.
- Remove the "provisional" wording from the triage copy on the Workbench.
- Headline stats above the table: distinct tickets with a miss, total misses, excused, unexcused.

## 5. Out of scope

`src/pages/SlaReport.tsx` and `src/pages/SlaDashboard.tsx` keep their current shape. The Report's triage discipline section stays as-is apart from the provisional wording, which is handled in a separate pass if wanted.

## 6. Docs of record

After the change: `changelog_entries` row, `.lovable/project-knowledge.md` update routed through `sync-knowledge-pending`, and the `FlowDiagram.tsx` SLA Workbench description — as a separate docs-only pass, not folded into the logic turn.
