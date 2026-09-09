## Build steps

**1. Migration `0040_v3_ai_subject.sql` (additive).** On `public.intercom_tickets_v3`:
`subject_ai text`, `subject_ai_at timestamptz`, `subject_ai_model text`,
`subject_ai_source_hash text` (hash of the thread text it was written from, so an unchanged
ticket is never re-billed). Plus `settings.subject_ai_enabled boolean default true` and
`settings.subject_ai_daily_call_cap int default 200`, mirroring the severity-AI kill switch.

**2. Placeholder rule, one definition.** A subject is "useless" when it is null, blank, matches
`^Intercom #\d+$`, or is one of `(no subject)` / `no subject` / `untitled`. Implemented once in
`src/lib/subjectDisplay.ts` (`isPlaceholderSubject`) and mirrored in the SQL the scheduled pass
selects with — the two must agree, and the plan's verification checks that.

**3. Display rule extended.** `displaySubject()` becomes
`subject_override -> subject_ai -> subject -> "Untitled"`, with `subjectSource(row)` returning
`manual | ai | intercom | none`. `SUBJECT_SELECT` grows to
`subject,subject_override,subject_ai`. Every current reader already goes through the helper, so
the sweep is mechanical: `Triage`, `InboxV3` (table, sheet title, CSV export), `Prospects`,
`Escalations`, `OwnerDashboardV3`, `ResolutionAnatomy`, `CustomerReport`, `CsatReport`,
`MonthlyLookback`, `useSlaBatch`, `TicketFieldsPanel`, `EditableSubject`.

**4. Edge function `generate-ticket-subject`.** Modeled directly on `propose-severity`:
`requireEditor` gate, settings kill switch, daily cap, hard input truncation, skip when
`subject_ai_source_hash` is unchanged, max 25 ids per call. Input is the Intercom source body
plus the first few non-note customer/support messages (HTML stripped), capped at ~4000 chars.
Prompt reuses the ticket-title rules already proven in `parse-thread` (noun-led, 4–10 words, no
pleasantries, no trailing punctuation). Writes only the four `subject_ai*` columns, plus a
`conversation_audit_logs` row (`action: 'subject_ai_written'`).

Two modes: `mode: "auto"` (server-selected open placeholder tickets, refuses non-placeholder
and refuses tickets with a manual override) and `mode: "manual"` (an explicit conversation id,
any ticket, allowed to rewrite a perfectly good Intercom subject).

**5. Scheduled pass.** A managed HTTP schedule calling the function in `auto` mode, hourly, with
a small batch cap. Hourly rather than every few minutes because a placeholder subject is a
readability annoyance, not an alerting signal — worst case a new ticket waits under an hour for
its label, at one cheap run per hour.

**6. UI.**
- `TicketFieldsPanel`: a "Rewrite with AI" button next to the existing subject label input.
  Result lands in the input as a draft the operator can edit and save as a manual label, or
  accept as-is (it is already live as the AI subject). Editor-gated like every other control.
- Wherever a subject is shown with the "edited" hint today, an AI-written one gets an
  equivalent `AI` marker, with the Intercom subject on hover.
- One-click "Use Intercom's subject" clears the AI subject for that ticket.

**7. Backfill.** A one-shot run over the 19 open placeholder tickets, count reported before and
after. Closed tickets are explicitly excluded by the query, not by convention.

**8. Paperwork.** `.lovable/project-knowledge.md` via `sync-knowledge-pending` (staged for your
approval, never live), a `changelog_entries` row, and a FlowDiagram node.

## Cost

19 open placeholder tickets today, then roughly the new-ticket placeholder rate going forward.
The content hash means re-runs of unchanged tickets cost nothing. The daily cap and kill switch
are read from settings on every call, same as severity AI.

## Boundaries and known gaps

- **SLA channel inference untouched** — `slaMetrics` reads the subject off `raw_payload.source`,
  never the mirrored column, so no AI label can reclassify a ticket.
- **`v3_severity_eval_sample` keeps the raw subject** on purpose.
- **The Customers unattributed queue stays on the raw subject.** Its rows come from
  `SECURITY DEFINER` RPCs (`v3_no_signal_tickets`, `v3_personal_unlabeled_tickets`,
  `v3_tickets_for_channel`, `v3_tickets_for_override_key`) that select `subject` in SQL. Same
  named exception as the manual-override work — called out, not silently skipped.
- **Deep search indexes the raw subject** until `esh_refresh_search_index` is extended; a
  follow-up, not part of this step.
- **Legacy sources unchanged** — `manual_conversations`, `gmail_conversations`, Inbox v2.

## Verification before I call it done

- Run `manual` mode on `215475214997973`, confirm a real subject appears in Triage, Inbox v3,
  the detail sheet title and the CSV export, marked as AI, with `Intercom #215475214997973`
  still readable underneath.
- Type a manual label on the same ticket and confirm it beats the AI subject everywhere.
- Re-run `auto` on an unchanged ticket and confirm it is skipped by hash with no model call.
- Confirm `auto` refuses a ticket that has a manual override, and refuses a closed ticket.
- Confirm the kill switch (`subject_ai_enabled = false`) makes the function refuse.
- Run a v3 open sync afterwards and re-read the row to prove `subject_ai` survived and `subject`
  still tracks Intercom.
- Confirm a read-only account sees the AI subject with no rewrite control.
- Report the closed-ticket placeholder count before and after the backfill; it must be
  unchanged at 263.
